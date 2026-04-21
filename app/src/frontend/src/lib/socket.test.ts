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

// Hoisted-module helper: import the session store after `resetModules` so the
// store instance the SUT sees is the same one the test mutates. Each test
// re-imports both modules to get a clean slate.
const seedSession = async (): Promise<void> => {
  const { useSession } = await import('@/hooks/useSession');
  useSession.getState().setSession({
    id: 1,
    type: 'user',
    email: 'x@y.z',
    name: 'X',
    scopes: [],
  });
};

const clearSession = async (): Promise<void> => {
  const { useSession } = await import('@/hooks/useSession');
  useSession.getState().clearSession();
};

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

  it('getSocket() returns null when no session is present', async () => {
    await clearSession();
    const mod = await import('./socket');
    expect(mod.getSocket()).toBeNull();
    expect(ioMock).not.toHaveBeenCalled();
  });

  it('getSocket() returns null even if called repeatedly without a session', async () => {
    await clearSession();
    const mod = await import('./socket');
    mod.getSocket();
    mod.getSocket();
    mod.getSocket();
    expect(ioMock).not.toHaveBeenCalled();
  });

  it('getSocket() lazily creates the socket once a session is set', async () => {
    await clearSession();
    const mod = await import('./socket');
    expect(mod.getSocket()).toBeNull();
    await seedSession();
    const sock = mod.getSocket();
    expect(sock).toBe(mockSocket);
    expect(ioMock).toHaveBeenCalledTimes(1);
  });

  it('getSocket() returns a singleton — repeated calls hand back the same instance', async () => {
    await seedSession();
    const mod = await import('./socket');
    const a = mod.getSocket();
    const b = mod.getSocket();
    expect(a).toBe(b);
    // io() should have been called exactly once for the singleton.
    expect(ioMock).toHaveBeenCalledTimes(1);
  });

  it('ensureSocket() throws when no session is set', async () => {
    await clearSession();
    const mod = await import('./socket');
    expect(() => mod.ensureSocket()).toThrowError(/session/i);
    expect(ioMock).not.toHaveBeenCalled();
  });

  it('ensureSocket() creates the socket when a session is present', async () => {
    await seedSession();
    const mod = await import('./socket');
    const sock = mod.ensureSocket();
    expect(sock).toBe(mockSocket);
    expect(ioMock).toHaveBeenCalledTimes(1);
  });

  it('connects to VITE_BFF_URL with /ws namespace and withCredentials: true', async () => {
    vi.stubEnv('VITE_BFF_URL', 'https://bff.example.test');
    await seedSession();
    const mod = await import('./socket');
    mod.getSocket();
    expect(ioMock).toHaveBeenCalledTimes(1);
    const [url, opts] = ioMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('https://bff.example.test/ws');
    expect(opts).toMatchObject({ withCredentials: true });
  });

  it('falls back to same-origin /ws when VITE_BFF_URL is empty', async () => {
    vi.stubEnv('VITE_BFF_URL', '');
    await seedSession();
    const mod = await import('./socket');
    mod.getSocket();
    const [url] = ioMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('/ws');
  });

  it('registers a connect_error handler so reconnect failures do not kill the app', async () => {
    await seedSession();
    const mod = await import('./socket');
    mod.getSocket();
    // Smoke-test: at least one `on` call should wire 'connect_error'.
    const events = mockSocket.on.mock.calls.map((c) => c[0]);
    expect(events).toContain('connect_error');
  });

  it('disconnect() tears the singleton down and a subsequent getSocket() creates a new one', async () => {
    await seedSession();
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
