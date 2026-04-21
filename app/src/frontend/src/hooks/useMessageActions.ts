import { useCallback } from 'react';
import { getSocket } from '@/lib/socket';
import { WsEvent } from '@/lib/ws-events';
import { normaliseMessage, type Message } from '@/lib/messages';
import { getMessagesStore, type ConversationKeyArgs } from './useMessagesStore';

/**
 * Write-side actions: send / edit / delete. Each round-trips via the WS
 * gateway with an ack callback. The server then re-broadcasts the resulting
 * `message.new|edited|deleted` event to every session in the conversation
 * (including the sender), and `useMessagesSync` is what writes those into
 * the store.
 *
 * `sendMessage` additionally upserts the ack payload directly so the local
 * UI updates without waiting for the broadcast round-trip.
 */

export interface SendMessageArgs {
  body: string;
  replyToId?: bigint;
}

export interface UseMessageActionsReturn {
  sendMessage: (args: SendMessageArgs) => Promise<Message>;
  editMessage: (id: bigint, body: string) => Promise<void>;
  deleteMessage: (id: bigint) => Promise<void>;
}

const ackError = (ack: { error?: { code: string; message: string } } | undefined): Error | null => {
  if (!ack) return new Error('No ack from gateway');
  if (ack.error) {
    return Object.assign(new Error(ack.error.message), { code: ack.error.code });
  }
  return null;
};

export function useMessageActions(args: ConversationKeyArgs): UseMessageActionsReturn {
  const store = getMessagesStore(args);

  const sendMessage = useCallback(
    (send: SendMessageArgs): Promise<Message> =>
      new Promise((resolve, reject) => {
        const socket = getSocket();
        if (!socket) {
          reject(new Error('Socket not connected — log in first'));
          return;
        }
        const payload: Record<string, unknown> = { body: send.body };
        if (args.roomId !== undefined) payload.roomId = args.roomId;
        if (args.dmUserId !== undefined) payload.dmUserId = args.dmUserId;
        if (send.replyToId !== undefined) payload.replyToId = send.replyToId.toString();
        socket.emit(
          WsEvent.client.messageSend,
          payload,
          (ack: { message?: unknown; error?: { code: string; message: string } }) => {
            const err = ackError(ack);
            if (err) {
              reject(err);
              return;
            }
            if (ack.message) {
              try {
                const msg = normaliseMessage(ack.message as never);
                store.getState().upsert(msg);
                resolve(msg);
              } catch (e) {
                reject(e instanceof Error ? e : new Error(String(e)));
              }
              return;
            }
            reject(new Error('Malformed ack'));
          },
        );
      }),
    // store is stable per (roomId, dmUserId).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [args.roomId, args.dmUserId],
  );

  const editMessage = useCallback(
    (id: bigint, body: string): Promise<void> =>
      new Promise((resolve, reject) => {
        const socket = getSocket();
        if (!socket) {
          reject(new Error('Socket not connected — log in first'));
          return;
        }
        socket.emit(
          WsEvent.client.messageEdit,
          { id: id.toString(), body },
          (ack: { ok?: boolean; error?: { code: string; message: string } }) => {
            const err = ackError(ack);
            if (err) {
              reject(err);
              return;
            }
            resolve();
          },
        );
      }),
    [],
  );

  const deleteMessage = useCallback(
    (id: bigint): Promise<void> =>
      new Promise((resolve, reject) => {
        const socket = getSocket();
        if (!socket) {
          reject(new Error('Socket not connected — log in first'));
          return;
        }
        socket.emit(
          WsEvent.client.messageDelete,
          { id: id.toString() },
          (ack: { ok?: boolean; error?: { code: string; message: string } }) => {
            const err = ackError(ack);
            if (err) {
              reject(err);
              return;
            }
            resolve();
          },
        );
      }),
    [],
  );

  return { sendMessage, editMessage, deleteMessage };
}
