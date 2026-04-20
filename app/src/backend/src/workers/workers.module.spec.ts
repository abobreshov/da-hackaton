/**
 * Contract test for `WorkersModule.forRoot({ enabled })`.
 *
 * The gate matters for production: the main backend process (HTTP + TCP)
 * must boot with `enabled=false` so BullMQ workers do not share its
 * event loop; a dedicated `backend-worker` process boots with
 * `enabled=true`.
 *
 * We only assert the shape of the `DynamicModule` — no Nest bootstrap,
 * no redis. Instantiating providers would require a live redis server,
 * which these tests deliberately avoid.
 */

// `../config/environment` parses `process.env` at import time (zod schema)
// and throws when required vars are missing. The WorkersModule chain
// eventually reaches that import, so fixture values must be set *before*
// any `import` below resolves — hence the top-of-file assignments.
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/appdb';
process.env.SYSTEM_KEY = process.env.SYSTEM_KEY ?? 'test-system-key-min-32-characters-ok';

import { WorkersModule } from './workers.module';
import { QueueProducer } from './queue.producer';
import {
  ABUSE_REPORT_NOTIFY_QUEUE,
  ATTACHMENTS_CLEANUP_QUEUE,
  RETENTION_PRUNE_QUEUE,
  USER_CASCADE_DELETE_QUEUE,
} from './queue.tokens';

describe('WorkersModule.forRoot', () => {
  it('returns an empty dynamic module when enabled=false', () => {
    const mod = WorkersModule.forRoot({ enabled: false });
    expect(mod.module).toBe(WorkersModule);
    expect(mod.providers ?? []).toHaveLength(0);
    expect(mod.exports ?? []).toHaveLength(0);
    expect(mod.imports ?? []).toHaveLength(0);
  });

  it('wires providers + exports when enabled=true', () => {
    const mod = WorkersModule.forRoot({ enabled: true });
    expect(mod.module).toBe(WorkersModule);

    const providers = mod.providers ?? [];
    expect(providers.length).toBeGreaterThan(0);
    // QueueProducer is a class-provider; other entries are factory providers
    // on string tokens — assert QueueProducer class is registered.
    expect(providers).toEqual(expect.arrayContaining([QueueProducer]));

    const exports_ = mod.exports ?? [];
    expect(exports_).toEqual(
      expect.arrayContaining([
        QueueProducer,
        USER_CASCADE_DELETE_QUEUE,
        RETENTION_PRUNE_QUEUE,
        ATTACHMENTS_CLEANUP_QUEUE,
        ABUSE_REPORT_NOTIFY_QUEUE,
      ]),
    );
  });
});
