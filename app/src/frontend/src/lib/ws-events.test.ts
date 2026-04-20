import { describe, it, expect, expectTypeOf } from 'vitest';
import {
  WsEvent,
  type WsServerEventName,
  type WsClientEventName,
  type WsServerEvent,
  type WsClientEvent,
} from './ws-events';

describe('ws-events re-exports', () => {
  it('re-exports the WsEvent contract with server + client buckets', () => {
    expect(WsEvent).toBeDefined();
    expect(WsEvent.server).toBeDefined();
    expect(WsEvent.client).toBeDefined();
    // Spot-check a couple of known event names from the contract.
    expect(WsEvent.server.messageNew).toBe('message.new');
    expect(WsEvent.client.messageSend).toBe('message.send');
  });

  it('server + client event maps are non-empty', () => {
    expect(Object.keys(WsEvent.server).length).toBeGreaterThan(0);
    expect(Object.keys(WsEvent.client).length).toBeGreaterThan(0);
  });

  it('event name type unions derive from the contract', () => {
    // These are compile-time assertions; keeping one runtime anchor so the
    // test still exercises the imported types.
    const srv: WsServerEventName = WsEvent.server.messageNew;
    const cli: WsClientEventName = WsEvent.client.messageSend;
    expect(srv).toBe('message.new');
    expect(cli).toBe('message.send');

    expectTypeOf<WsServerEventName>().toEqualTypeOf<
      (typeof WsEvent.server)[keyof typeof WsEvent.server]
    >();
    expectTypeOf<WsClientEventName>().toEqualTypeOf<
      (typeof WsEvent.client)[keyof typeof WsEvent.client]
    >();
  });

  it('payload wrapper helpers type-check at their event-name key', () => {
    const evt: WsServerEvent<'messageNew'> = {
      type: WsEvent.server.messageNew,
      payload: { id: 1 },
    };
    const out: WsClientEvent<'messageSend'> = {
      type: WsEvent.client.messageSend,
      payload: { body: 'hi' },
    };
    expect(evt.type).toBe('message.new');
    expect(out.type).toBe('message.send');
  });
});
