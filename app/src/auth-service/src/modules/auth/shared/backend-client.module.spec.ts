// Env must be seeded before the module (which reads env at import time) loads.
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/test';
process.env.JWT_ADMIN_SECRET = process.env.JWT_ADMIN_SECRET ?? 'x'.repeat(48);
process.env.JWT_CUSTOMER_SECRET = process.env.JWT_CUSTOMER_SECRET ?? 'y'.repeat(48);
process.env.SYSTEM_KEY = process.env.SYSTEM_KEY ?? 'z'.repeat(48);
process.env.BACKEND_TCP_HOST = process.env.BACKEND_TCP_HOST ?? '127.0.0.1';
process.env.BACKEND_TCP_PORT = process.env.BACKEND_TCP_PORT ?? '4004';

// Intercept ClientsModule.register so we can assert the config without
// standing up a real TCP client. We keep @nestjs/microservices real but
// replace its `.register` static.
const registerSpy = jest.fn().mockImplementation((clients: unknown) => ({
  module: class FakeRegistered {},
  providers: [],
  exports: [],
  __clients: clients,
}));

jest.mock('@nestjs/microservices', () => {
  const actual = jest.requireActual('@nestjs/microservices');
  return {
    ...actual,
    ClientsModule: {
      ...actual.ClientsModule,
      register: (clients: unknown) => registerSpy(clients),
    },
  };
});

describe('BackendClientModule', () => {
  beforeEach(() => {
    registerSpy.mockClear();
    jest.resetModules();
  });

  it('registers a TCP ClientProxy keyed by BACKEND_SERVICE', async () => {
    const mod = await import('./backend-client.module');
    expect(mod.BACKEND_SERVICE).toBe('BACKEND_SERVICE');
    expect(registerSpy).toHaveBeenCalledTimes(1);

    const clients = registerSpy.mock.calls[0][0] as Array<{
      name: string;
      transport: unknown;
      options: { host: string; port: number; tlsOptions?: unknown };
    }>;
    expect(clients).toHaveLength(1);
    expect(clients[0].name).toBe('BACKEND_SERVICE');
    // drizzle isn't involved — transport constant comes from @nestjs/microservices.
    const { Transport } = await import('@nestjs/microservices');
    expect(clients[0].transport).toBe(Transport.TCP);
    expect(clients[0].options).toMatchObject({
      host: '127.0.0.1',
      port: 4004,
    });
    // No TLS by default → no tlsOptions present.
    expect(clients[0].options.tlsOptions).toBeUndefined();
  });
});
