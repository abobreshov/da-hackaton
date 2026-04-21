-- 0011_concurrent_indexes.sql
--
-- Production-safe index additions. Every statement here uses
-- `CREATE INDEX CONCURRENTLY` so it does NOT take an `ACCESS EXCLUSIVE`
-- lock on the target table — readers and writers continue while the
-- index builds.
--
-- IMPORTANT — manual migration semantics:
--   * `CREATE INDEX CONCURRENTLY` cannot run inside a transaction block.
--     drizzle-kit wraps each migration in a TX by default; this file
--     therefore must be applied outside the normal `db:migrate` flow in
--     production (run with `psql -1=off`, autocommit, or split per
--     statement).
--   * `IF NOT EXISTS` makes every statement idempotent — safe to re-run
--     after an interrupted build leaves an `INVALID` index behind. Drop
--     the invalid index first (`DROP INDEX CONCURRENTLY <name>;`) then
--     re-run this migration.
--   * Dev / CI may apply this via `db:migrate` without harm — locks are
--     irrelevant on an empty schema, and CONCURRENTLY still works (it
--     is just slower than a regular `CREATE INDEX`).
--
-- See `app/src/backend/drizzle/README.md` for the full prod playbook
-- and a list of legacy migrations that are NOT CONCURRENTLY-safe.

-- sys-arch MED 3 — unread fan-out scale.
--
-- `UnreadRepository.countSinceForRoomMembers` issues a correlated
-- subquery `WHERE m.room_id = :roomId AND m.deleted_at IS NULL
-- AND m.id > COALESCE(ulr.last_read_id, 0)` per room member. The existing
-- `messages_room_created_idx (room_id, created_at DESC, id DESC)` is
-- sorted by created_at first, so the planner has to scan a wide range
-- and filter by id. A `(room_id, id)` partial index lets the planner
-- do a tight index range scan keyed on the bigserial id directly.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "messages_room_id_idx"
  ON "messages" USING btree ("room_id", "id")
  WHERE "deleted_at" IS NULL;
