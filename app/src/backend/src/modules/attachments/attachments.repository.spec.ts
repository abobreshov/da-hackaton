/**
 * Minimal Drizzle-adapter test for `findByMessageIds`. The full attachments
 * repo behaviour is exercised by the service spec via an in-memory fake;
 * here we just lock the wiring for the bulk-hydrate path so the SQL never
 * silently switches to the wrong column or eats the empty-ids edge case.
 */

jest.mock('../../config/environment', () => ({
  env: { DATABASE_URL: 'postgres://test', SYSTEM_KEY: 'x'.repeat(32), TLS_ENABLED: false },
}));
jest.mock('../../database/connection', () => ({
  db: {},
  pool: { end: () => Promise.resolve() },
}));

jest.mock('drizzle-orm', () => ({
  and: jest.fn((...parts: any[]) => ({ kind: 'and', parts })),
  eq: jest.fn((col: any, val: any) => ({ kind: 'eq', col: col?._name, val })),
  inArray: jest.fn((col: any, vals: any[]) => ({ kind: 'inArray', col: col?._name, vals })),
  isNull: jest.fn((col: any) => ({ kind: 'isNull', col: col?._name })),
  or: jest.fn((...parts: any[]) => ({ kind: 'or', parts })),
  sql: Object.assign((..._a: any[]) => ({}), { raw: () => ({}) }),
}));

jest.mock('../../database/schema', () => {
  const mkCol = (name: string) => ({ _name: name });
  return {
    attachments: {
      _sym: 'attachments',
      id: mkCol('id'),
      roomId: mkCol('room_id'),
      dmId: mkCol('dm_id'),
      messageId: mkCol('message_id'),
      uploaderId: mkCol('uploader_id'),
      filename: mkCol('filename'),
      mime: mkCol('mime'),
      sizeBytes: mkCol('size_bytes'),
      path: mkCol('path'),
      comment: mkCol('comment'),
      isImage: mkCol('is_image'),
      createdAt: mkCol('created_at'),
    },
    dmChannels: {
      _sym: 'dm_channels',
      id: { _name: 'id' },
      userLow: { _name: 'user_low' },
      userHigh: { _name: 'user_high' },
    },
  };
});

import { DrizzleAttachmentsRepository } from './attachments.repository';
import type { AttachmentRow } from './attachments.types';

interface SelectCall {
  table: unknown;
  where?: any;
}

function makeDb(rows: AttachmentRow[]) {
  const calls: SelectCall[] = [];
  const chain: any = {
    from: jest.fn((t: any) => {
      calls.push({ table: t });
      return chain;
    }),
    where: jest.fn(async (w: any) => {
      calls[calls.length - 1].where = w;
      return rows;
    }),
  };
  const db = { select: jest.fn(() => chain) };
  return { db, calls };
}

describe('DrizzleAttachmentsRepository.findByMessageIds', () => {
  it('returns an empty Map and skips the query when ids is empty', async () => {
    const { db } = makeDb([]);
    const repo = new DrizzleAttachmentsRepository(db as any);
    const out = await repo.findByMessageIds([]);
    expect(out.size).toBe(0);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('emits one IN-list query keyed on message_id and groups rows', async () => {
    const r1: AttachmentRow = {
      id: 'a1',
      roomId: 1,
      dmId: null,
      messageId: 10n,
      uploaderId: 7,
      filename: 'a.png',
      mime: 'image/png',
      sizeBytes: 1,
      path: 'p1',
      comment: null,
      isImage: true,
      createdAt: null,
    };
    const r2: AttachmentRow = { ...r1, id: 'a2', messageId: 10n };
    const r3: AttachmentRow = { ...r1, id: 'b1', messageId: 11n };
    const { db, calls } = makeDb([r1, r2, r3]);
    const repo = new DrizzleAttachmentsRepository(db as any);

    const out = await repo.findByMessageIds([10n, 11n]);

    expect(db.select).toHaveBeenCalledTimes(1);
    expect(calls[0].where).toEqual(
      expect.objectContaining({ kind: 'inArray', col: 'message_id', vals: [10n, 11n] }),
    );
    expect(out.get(10n)?.map((r) => r.id).sort()).toEqual(['a1', 'a2']);
    expect(out.get(11n)?.map((r) => r.id)).toEqual(['b1']);
  });

  it('drops rows whose messageId is null (defensive)', async () => {
    const orphan: AttachmentRow = {
      id: 'orphan',
      roomId: 1,
      dmId: null,
      messageId: null,
      uploaderId: 7,
      filename: 'x',
      mime: 'image/png',
      sizeBytes: 1,
      path: 'p',
      comment: null,
      isImage: true,
      createdAt: null,
    };
    const { db } = makeDb([orphan]);
    const repo = new DrizzleAttachmentsRepository(db as any);
    const out = await repo.findByMessageIds([10n]);
    expect(out.size).toBe(0);
  });
});
