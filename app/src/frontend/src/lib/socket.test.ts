import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Shared mock socket instance returned by the mocked `io()` factory.
const mockSocket = {
  connected: false,
  disconnect: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
  io: { on: vi.fn(), off: vi.fn() },
};
const ioMock = vi.fn(() => mockSocket);

vi.mock('socket.io-client', () => ({
  io: (url: string, opts: unknown) => ioMock(url, opts),
}));

describe('lib/socket', () => {
  beforeEach(async () => {
    // Reset module state so each test sees a fresh singleton cache.
    vi.resetModules();
    ioMock.mockClear();
    mockSocket.disconnect.mockClear();
    mockSocket.on.mockClear();
    mockSocket.off.mockClear();
    mockSocket.emit.mockClear();
    mockSocket.io.on.mockClear();
    mockSocket.io.off.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('getSocket() returns a singleton — repeated calls hand back the same instance', async () => {
    const mod = await import('./socket');
    const a = mod.getSocket();
    const b = mod.getSocket();
    expect(a).toBe(b);
    // io() should have been called exactly once for the singleton.
    expect(ioMock).toHaveBeenCalledTimes(1);
  });

  it('connects to VITE_BFF_URL with /ws namespace and withCredentials: true', async () => {
    vi.stubEnv('VITE_BFF_URL', 'https://bff.example.test');
    const mod = await import('./socket');
    mod.getSocket();
    expect(ioMock).toHaveBeenCalledTimes(1);
    const [url, opts] = ioMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('https://bff.example.test/ws');
    expect(opts).toMatchObject({ withCredentials: true });
  });

  it('falls back to same-origin /ws when VITE_BFF_URL is empty', async () => {
    vi.stubEnv('VITE_BFF_URL', '');
    const mod = await import('./socket');
    mod.getSocket();
    const [url] = ioMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('/ws');
  });

  it('registers a connect_error handler so reconnect failures do not kill the app', async () => {
    const mod = await import('./socket');
    mod.getSocket();
    // Smoke-test: at least one `on` call should wire 'connect_error'.
    const events = mockSocket.on.mock.calls.map((c) => c[0]);
    expect(events).toContain('connect_error');
  });

  it('disconnect() tears the singleton down and a subsequent getSocket() creates a new one', async () => {
    const mod = await import('./socket');
    const first = mod.getSocket();
    expect(first).toBe(mockSocket);

    mod.disconnect();
    expect(mockSocket.disconnect).toHaveBeenCalledTimes(1);

    // After teardown, a fresh call should produce a new io() invocation.
    const second = mod.getSocket();
    expect(second).toBe(mockSocket);
    expect(ioMock).toHaveBeenCalledTimes(2);
  });
});
