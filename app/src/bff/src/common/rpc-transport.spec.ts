/**
 * rpc-transport — withSys injection + buildTcpClientOptions TLS branch coverage.
 *
 * withSys is pure & deterministic once env.SYSTEM_KEY is stubbed. The TLS
 * branches require juggling the env mock and fs reads, so we re-import the
 * module inside each test with jest.isolateModules to pick up new env state.
 */
import { Transport } from '@nestjs/microservices';

// Default env — TLS off, deterministic system key.
jest.mock('./../config/environment', () => ({
  env: {
    SYSTEM_KEY: 'test-sys-key',
    TLS_ENABLED: false,
    TLS_CA_PATH: undefined,
    TLS_CERT_PATH: undefined,
    TLS_KEY_PATH: undefined,
  },
}));

describe('withSys', () => {
  it('injects _sys=SYSTEM_KEY into a plain payload', () => {
    const { withSys } = require('./rpc-transport');
    expect(withSys({ email: 'a@b' })).toEqual({ email: 'a@b', _sys: 'test-sys-key' });
  });

  it('does not mutate the caller object', () => {
    const { withSys } = require('./rpc-transport');
    const payload = { foo: 1 };
    const wrapped = withSys(payload);
    expect(wrapped).not.toBe(payload);
    expect(payload).toEqual({ foo: 1 });
    expect(wrapped).toEqual({ foo: 1, _sys: 'test-sys-key' });
  });

  it('overwrites a pre-existing _sys key from the caller (defense-in-depth)', () => {
    const { withSys } = require('./rpc-transport');
    const out = withSys({ _sys: 'attacker-supplied' } as any);
    expect(out._sys).toBe('test-sys-key');
  });

  it('handles empty payload', () => {
    const { withSys } = require('./rpc-transport');
    expect(withSys({})).toEqual({ _sys: 'test-sys-key' });
  });
});

describe('buildTcpClientOptions', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('returns TCP transport without tlsOptions when TLS_ENABLED=false', () => {
    jest.doMock('./../config/environment', () => ({
      env: {
        SYSTEM_KEY: 'k',
        TLS_ENABLED: false,
        TLS_CA_PATH: undefined,
        TLS_CERT_PATH: undefined,
        TLS_KEY_PATH: undefined,
      },
    }));
    let opts: any;
    jest.isolateModules(() => {
      const mod = require('./rpc-transport');
      opts = mod.buildTcpClientOptions('127.0.0.1', 4003);
    });
    expect(opts.transport).toBe(Transport.TCP);
    expect(opts.options).toEqual({ host: '127.0.0.1', port: 4003 });
    expect(opts.options.tlsOptions).toBeUndefined();
  });

  it('builds TCP transport with tlsOptions when TLS_ENABLED=true and certs exist', () => {
    jest.doMock('./../config/environment', () => ({
      env: {
        SYSTEM_KEY: 'k',
        TLS_ENABLED: true,
        TLS_CA_PATH: '/fake/ca.crt',
        TLS_CERT_PATH: '/fake/service.crt',
        TLS_KEY_PATH: '/fake/service.key',
      },
    }));
    jest.doMock('node:fs', () => ({
      existsSync: jest.fn().mockReturnValue(true),
      readFileSync: jest.fn((p: string) => Buffer.from(`content-of:${p}`)),
    }));

    let opts: any;
    jest.isolateModules(() => {
      const mod = require('./rpc-transport');
      opts = mod.buildTcpClientOptions('backend', 4004);
    });
    expect(opts.transport).toBe(Transport.TCP);
    expect(opts.options.host).toBe('backend');
    expect(opts.options.port).toBe(4004);
    expect(opts.options.tlsOptions).toBeDefined();
    expect(opts.options.tlsOptions.ca.toString()).toBe('content-of:/fake/ca.crt');
    expect(opts.options.tlsOptions.cert.toString()).toBe('content-of:/fake/service.crt');
    expect(opts.options.tlsOptions.key.toString()).toBe('content-of:/fake/service.key');
    expect(opts.options.tlsOptions.rejectUnauthorized).toBe(true);
  });

  it('throws a helpful error when TLS_ENABLED=true but cert files are missing', () => {
    jest.doMock('./../config/environment', () => ({
      env: {
        SYSTEM_KEY: 'k',
        TLS_ENABLED: true,
        TLS_CA_PATH: '/nope/ca.crt',
        TLS_CERT_PATH: undefined,
        TLS_KEY_PATH: '/nope/key.pem',
      },
    }));
    jest.doMock('node:fs', () => ({
      existsSync: jest.fn().mockReturnValue(false),
      readFileSync: jest.fn(),
    }));

    expect(() => {
      jest.isolateModules(() => {
        const mod = require('./rpc-transport');
        mod.buildTcpClientOptions('h', 1);
      });
    }).toThrow(/TLS_ENABLED=true but cert files are missing/);
  });
});
