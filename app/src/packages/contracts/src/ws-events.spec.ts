import { WsEvent } from './ws-events';

describe('WsEvent', () => {
  it('server.messageNew === "message.new"', () => {
    expect(WsEvent.server.messageNew).toBe('message.new');
  });

  it('client.messageSend === "message.send"', () => {
    expect(WsEvent.client.messageSend).toBe('message.send');
  });

  it('has no possessive suffixes (.me or .you) anywhere in values', () => {
    const allValues = [...Object.values(WsEvent.client), ...Object.values(WsEvent.server)];
    for (const v of allValues) {
      expect(v).not.toMatch(/\.me($|\.)/);
      expect(v).not.toMatch(/\.you($|\.)/);
    }
  });

  it('has no duplicate event strings across client + server maps', () => {
    const allValues = [...Object.values(WsEvent.client), ...Object.values(WsEvent.server)];
    expect(new Set(allValues).size).toBe(allValues.length);
  });
});
