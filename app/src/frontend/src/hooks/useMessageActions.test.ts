import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const emitMock = vi.fn();
const onMock = vi.fn();
const offMock = vi.fn();

vi.mock('@/lib/socket', () => ({
  getSocket: () => ({
    emit: emitMock,
    on: onMock,
    off: offMock,
    connected: true,
  }),
  disconnect: vi.fn(),
}));

import { useMessageActions } from './useMessageActions';
import { resetMessagesStores, getMessagesStore } from './useMessagesStore';

const takeAck = (event: string): ((res: unknown) => void) => {
  const call = [...emitMock.mock.calls].reverse().find((c) => c[0] === event);
  if (!call) throw new Error(`no ${event} emit recorded`);
  const ack = call[call.length - 1] as (res: unknown) => void;
  if (typeof ack !== 'function') throw new Error(`no ack callback in ${event} emit`);
  return ack;
};

const wireMessage = (id: bigint, body: string, createdAt: string) => ({
  id: id.toString(),
  roomId: 42,
  authorId: 1,
  authorUsername: 'alice',
  body,
  createdAt,
});

describe('useMessageActions (send / edit / delete)', () => {
  beforeEach(() => {
    emitMock.mockClear();
    onMock.mockClear();
    offMock.mockClear();
    resetMessagesStores();
  });
  afterEach(() => {
    resetMessagesStores();
  });

  it('sendMessage emits message.send with roomId and upserts the ack into the store', async () => {
    const { result } = renderHook(() => useMessageActions({ roomId: 42 }));
    const promise = result.current.sendMessage({ body: 'hi there' });
    const call = emitMock.mock.calls.find((c) => c[0] === 'message.send');
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({ roomId: 42, body: 'hi there' });
    const ack = takeAck('message.send');
    act(() => {
      ack({ message: wireMessage(20n, 'hi there', '2026-04-20T10:10:00.000Z') });
    });
    const msg = await promise;
    expect(msg.id).toBe(20n);
    expect(getMessagesStore({ roomId: 42 }).getState().byId.has(20n)).toBe(true);
  });

  it('sendMessage carries dmUserId + stringified replyToId when in DM mode', async () => {
    const { result } = renderHook(() => useMessageActions({ dmUserId: 7 }));
    const promise = result.current
      .sendMessage({ body: 'hi', replyToId: 9n })
      .catch(() => null); // we don't ack here — just inspecting the emit
    const call = emitMock.mock.calls.find((c) => c[0] === 'message.send');
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({ dmUserId: 7, body: 'hi', replyToId: '9' });
    // Ack with error to close out the promise cleanly.
    const ack = takeAck('message.send');
    act(() => ack({ error: { code: 'NOPE', message: 'nope' } }));
    await promise;
  });

  it('sendMessage rejects with a coded Error when ack carries an error', async () => {
    const { result } = renderHook(() => useMessageActions({ roomId: 42 }));
    const promise = result.current.sendMessage({ body: 'hi' }).catch((e) => e);
    const ack = takeAck('message.send');
    act(() => {
      ack({ error: { code: 'DM_FROZEN', message: 'frozen' } });
    });
    const err = await promise;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error & { code?: string }).code).toBe('DM_FROZEN');
    expect((err as Error).message).toBe('frozen');
  });

  it('sendMessage rejects when ack is missing entirely', async () => {
    const { result } = renderHook(() => useMessageActions({ roomId: 42 }));
    const promise = result.current.sendMessage({ body: 'hi' }).catch((e) => e);
    const ack = takeAck('message.send');
    act(() => ack(undefined));
    const err = await promise;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/no ack/i);
  });

  it('editMessage emits message.edit with id + body and resolves on ok', async () => {
    const { result } = renderHook(() => useMessageActions({ roomId: 42 }));
    const promise = result.current.editMessage(5n, 'new body');
    const call = emitMock.mock.calls.find((c) => c[0] === 'message.edit');
    expect(call).toBeDefined();
    expect(call![1]).toEqual({ id: '5', body: 'new body' });
    const ack = takeAck('message.edit');
    act(() => ack({ ok: true }));
    await expect(promise).resolves.toBeUndefined();
  });

  it('editMessage rejects with the ack error code', async () => {
    const { result } = renderHook(() => useMessageActions({ roomId: 42 }));
    const promise = result.current.editMessage(5n, 'x').catch((e) => e);
    const ack = takeAck('message.edit');
    act(() => ack({ error: { code: 'FORBIDDEN', message: 'nope' } }));
    const err = await promise;
    expect((err as Error & { code?: string }).code).toBe('FORBIDDEN');
  });

  it('deleteMessage emits message.delete with id and resolves on ok', async () => {
    const { result } = renderHook(() => useMessageActions({ roomId: 42 }));
    const promise = result.current.deleteMessage(5n);
    const call = emitMock.mock.calls.find((c) => c[0] === 'message.delete');
    expect(call).toBeDefined();
    expect(call![1]).toEqual({ id: '5' });
    const ack = takeAck('message.delete');
    act(() => ack({ ok: true }));
    await expect(promise).resolves.toBeUndefined();
  });

  it('deleteMessage rejects with the ack error code', async () => {
    const { result } = renderHook(() => useMessageActions({ roomId: 42 }));
    const promise = result.current.deleteMessage(5n).catch((e) => e);
    const ack = takeAck('message.delete');
    act(() => ack({ error: { code: 'FORBIDDEN', message: 'nope' } }));
    const err = await promise;
    expect((err as Error & { code?: string }).code).toBe('FORBIDDEN');
  });
});
