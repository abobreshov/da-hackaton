/**
 * Typed WebSocket event helpers.
 *
 * The WS gateway is not live yet — this module exists so future socket
 * subscriptions share the same event-name source of truth as the backend
 * (`@app/contracts/ws-events`). No runtime connection is created here.
 */

import { WsEvent } from '@app/contracts';

export { WsEvent };

/** Event-name string literal unions, derived from the contract. */
export type WsServerEventName = (typeof WsEvent.server)[keyof typeof WsEvent.server];
export type WsClientEventName = (typeof WsEvent.client)[keyof typeof WsEvent.client];

/**
 * Placeholder generic for future typed event payload dispatch.
 *
 * Once payload schemas land in `@app/contracts`, this alias will narrow
 * to the matching payload type. For now it's a stub that keeps the
 * call-site ergonomic (`WsServerEvent<'messageNew'>`) without forcing
 * consumers to change signatures later.
 */
export type WsServerEvent<K extends keyof typeof WsEvent.server> = {
  type: (typeof WsEvent.server)[K];
  payload: unknown;
};

export type WsClientEvent<K extends keyof typeof WsEvent.client> = {
  type: (typeof WsEvent.client)[K];
  payload: unknown;
};
