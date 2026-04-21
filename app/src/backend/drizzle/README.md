# Drizzle migrations — production safety notes

drizzle-kit emits **plain** `CREATE INDEX` (no `CONCURRENTLY`) and wraps
each migration in a single transaction. That's fine for an empty dev DB
but on a populated production table:

* `CREATE INDEX` takes an `ACCESS EXCLUSIVE` lock for the duration of
  the build — readers and writers block until it finishes.
* `CREATE INDEX CONCURRENTLY` cannot run inside a transaction block, so
  drizzle-kit cannot emit it.

We keep dev migrations untouched (they've already been applied to local
DBs and re-running with different DDL would diverge state) and add a
parallel **`*_concurrent_*.sql`** migration whenever a new index is
needed. Production deploys apply those files manually outside the TX
wrapper.

## Migration audit (as of 0011)

The following past migrations contain blocking `CREATE INDEX`
statements. None has shipped to a production DB yet — if/when one does,
follow the prod swap recipe below before applying.

| File | Index(es) | Notes |
| --- | --- | --- |
| `0000_empty_fantastic_four.sql` | `password_resets_user_idx` | small table, low risk |
| `0001_needy_mongoose.sql` | `user_sessions_user_active_idx` (partial) | small table |
| `0002_luxuriant_dark_phoenix.sql` | `friendships_pair_unique`, `friendships_user_a_accepted_idx`, `friendships_user_b_accepted_idx`, `friendships_pending_idx`, `user_bans_banned_idx` | partials + unique; **unique CONCURRENTLY needs care** — see below |
| `0003_glamorous_mariko_yashida.sql` | `room_invitations_room_invitee_unique`, `room_invitations_invitee_pending_idx`, `room_memberships_user_idx`, `rooms_name_trgm` (gin) | gin trgm on `rooms(name)` is the most expensive on a hot table |
| `0004_glorious_tarot.sql` | `abuse_reports_status_idx`, `abuse_reports_open_dedup_idx` (unique partial), `abuse_reports_target_idx`, `audit_log_*` | `audit_log` grows fast — these are the highest-risk in the set |
| `0005_blushing_umar.sql` | `dm_channels_pair_unique`, `messages_room_created_idx`, `messages_dm_created_idx`, `messages_reply_to_idx`, `messages_author_idx`, `messages_created_prune_idx` | hot `messages` table — biggest blockers |
| `0007_brief_wonder_man.sql` | `attachments_*` (4 partials) | `attachments` likely big in prod |
| `0008_robust_madelyne_pryor.sql` | `user_last_read_scope_idx` (functional unique on COALESCE) | functional + unique → CONCURRENTLY rebuild is multi-step |
| `0009_gorgeous_justin_hammer.sql` | `DROP` + `CREATE` of `messages_room_created_idx` and `messages_dm_created_idx` | also blocking; drop side is fast, recreate is the problem |
| `0010_solid_praxagora.sql` | `users_name_lower_idx` (functional `lower(name)`) | small-medium table |

`0006_*.sql` is a non-DDL migration and `0011_concurrent_indexes.sql`
is already CONCURRENTLY-safe.

## Prod swap recipe — split TX-then-INDEX

When promoting one of the above to prod, do **not** run the original
migration. Instead:

1. Take the original `CREATE INDEX ... ;` statements out of the file
   into a sibling SQL script (e.g. `0005_messages_indexes.prod.sql`).
2. Rewrite each as:

   ```sql
   CREATE INDEX CONCURRENTLY IF NOT EXISTS "<name>" ON "<table>" ... ;
   ```

3. Apply the *non-index* portion of the migration via the normal
   transactional path (`db:migrate` or `psql -1`). That portion is
   usually `CREATE TABLE` / `ALTER TABLE` and is fine inside a TX.
4. Apply the index script with autocommit on, one statement at a time,
   from a session that is **not** inside a transaction:

   ```bash
   psql "$DATABASE_URL" \
     --set=ON_ERROR_STOP=1 \
     --single-transaction=off \
     -f migrations.prod/0005_messages_indexes.prod.sql
   ```

5. Verify nothing built `INVALID`:

   ```sql
   SELECT i.indexrelid::regclass, i.indisvalid
     FROM pg_index i
    WHERE NOT i.indisvalid;
   ```

   Any row → `DROP INDEX CONCURRENTLY <name>;` then re-run the failing
   statement.

## Unique / functional indexes — extra care

`CREATE UNIQUE INDEX CONCURRENTLY` is allowed but builds in two
phases. If the second phase fails (duplicate row appears mid-build) the
result is an `INVALID` index that still consumes write amplification on
every insert. Always check `pg_index.indisvalid` after a CONCURRENTLY
unique build. Functional indexes (`lower(name)`, `COALESCE(...)`)
behave the same way — the build is online but the validation phase can
still fail.

## Adding a new index

Default to: edit the schema in `src/database/schema/*.ts` AND add a
`CREATE INDEX CONCURRENTLY IF NOT EXISTS` statement to
`0011_concurrent_indexes.sql` (or the next concurrent-only migration if
0011 has shipped). Do not let `drizzle-kit generate` write a blocking
`CREATE INDEX` into a fresh migration file for an index that will hit
prod — copy it out into the concurrent file and delete it from the
generated migration before commit.
