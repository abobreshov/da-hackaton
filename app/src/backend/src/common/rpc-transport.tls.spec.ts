/**
 * Characterization tests for the TLS-enabled branch of rpc-transport.ts.
 *
 * Split into a dedicated spec so we can `jest.mock('node:fs')` without
 * affecting the plain `rpc-transport.spec.ts` which runs with TLS_ENABLED=false.
 */

jest.mock('node:fs', () => ({
  existsSync: jest.fn((p: string) => !String(p).includes('missing')),
  readFileSync: jest.fn((p: string) => Buffer.from(`content-of:${p}`)),
}));

jest.mock('./../config/environment', () => ({
  env: {
    SYSTEM_KEY: 'test-system-key-32-char-value-abcde',
    TLS_ENABLED: true,
    TLS_CA_PATH: '/certs/ca.pem',
    TLS_CERT_PATH: '/certs/cert.pem',
    TLS_KEY_PATH: '/certs/key.pem',
  },
}));

import { Transport } from '@nestjs/microservices';
import { buildTcpMicroserviceOptions, buildTcpClientOptions } from './rpc-transport';

describe('rpc-transport (TLS_ENABLED=true)', () => {
  describe('buildTcpMicroserviceOptions', () => {
    it('injects tlsOptions with requestCert + rejectUnauthorized for server', () => {
      const opts = buildTcpMicroserviceOptions('127.0.0.1', 4004) as any;
      expect(opts.transport).toBe(Transport.TCP);
      expect(opts.options.host).toBe('127.0.0.1');
      expect(opts.options.port).toBe(4004);
      expect(opts.options.tlsOptions).toBeDefined();
      expect(opts.options.tlsOptions.requestCert).toBe(true);
      expect(opts.options.tlsOptions.rejectUnauthorized).toBe(true);
      // cert bytes came from fs.readFileSync mock
      expect(opts.options.tlsOptions.ca).toBeInstanceOf(Buffer);
      expect(opts.options.tlsOptions.cert).toBeInstanceOf(Buffer);
      expect(opts.options.tlsOptions.key).toBeInstanceOf(Buffer);
    });
  });

  describe('buildTcpClientOptions', () => {
    it('injects tlsOptions with rejectUnauthorized for client (no requestCert)', () => {
      const opts = buildTcpClientOptions('localhost', 4003) as any;
      expect(opts.transport).toBe(Transport.TCP);
      expect(opts.options.host).toBe('localhost');
      expect(opts.options.port).toBe(4003);
      expect(opts.options.tlsOptions).toBeDefined();
      expect(opts.options.tlsOptions.rejectUnauthorized).toBe(true);
      // requestCert is server-only; client-side should not set it.
      expect(opts.options.tlsOptions.requestCert).toBeUndefined();
      expect(opts.options.tlsOptions.ca).toBeInstanceOf(Buffer);
    });
  });

  describe('assertTlsCerts (via buildTcp* entry points)', () => {
    it('throws a descriptive error when a cert file is missing', async () => {
      jest.resetModules();
      // Re-mock with a missing cert path so existsSync returns false for it.
      jest.doMock('node:fs', () => ({
        existsSync: jest.fn((p: string) => !String(p).includes('missing')),
        readFileSync: jest.fn((p: string) => Buffer.from(`content-of:${p}`)),
      }));
      jest.doMock('./../config/environment', () => ({
        env: {
          SYSTEM_KEY: 'test-system-key-32-char-value-abcde',
          TLS_ENABLED: true,
          TLS_CA_PATH: '/certs/missing-ca.pem',
          TLS_CERT_PATH: '/certs/cert.pem',
          TLS_KEY_PATH: '/certs/key.pem',
        },
      }));
       
      const mod = require('./rpc-transport');
      expect(() => mod.buildTcpMicroserviceOptions('h', 1)).toThrow(
        /TLS_ENABLED=true but cert files are missing/,
      );
    });

    it('lists all missing paths in one error message', async () => {
      jest.resetModules();
      jest.doMock('node:fs', () => ({
        existsSync: jest.fn(() => false),
        readFileSync: jest.fn(() => Buffer.from('x')),
      }));
      jest.doMock('./../config/environment', () => ({
        env: {
          SYSTEM_KEY: 'test-system-key-32-char-value-abcde',
          TLS_ENABLED: true,
          TLS_CA_PATH: '/a',
          TLS_CERT_PATH: '/b',
          TLS_KEY_PATH: '/c',
        },
      }));
       
      const mod = require('./rpc-transport');
      expect(() => mod.buildTcpClientOptions('h', 2)).toThrow(/TLS_CA_PATH/);
      expect(() => mod.buildTcpClientOptions('h', 2)).toThrow(/TLS_CERT_PATH/);
      expect(() => mod.buildTcpClientOptions('h', 2)).toThrow(/TLS_KEY_PATH/);
    });

    it('handles an unset path (undefined) in the missing list', async () => {
      jest.resetModules();
      jest.doMock('node:fs', () => ({
        existsSync: jest.fn(() => false),
        readFileSync: jest.fn(() => Buffer.from('x')),
      }));
      jest.doMock('./../config/environment', () => ({
        env: {
          SYSTEM_KEY: 'test-system-key-32-char-value-abcde',
          TLS_ENABLED: true,
          TLS_CA_PATH: undefined,
          TLS_CERT_PATH: undefined,
          TLS_KEY_PATH: undefined,
        },
      }));
       
      const mod = require('./rpc-transport');
      expect(() => mod.buildTcpClientOptions('h', 2)).toThrow(/<unset>/);
    });
  });
});

describe('rpc-transport (TLS_ENABLED=false) non-TLS path', () => {
  beforeAll(() => {
    jest.resetModules();
    jest.doMock('./../config/environment', () => ({
      env: {
        SYSTEM_KEY: 'test-system-key-32-char-value-abcde',
        TLS_ENABLED: false,
      },
    }));
  });

  it('buildTcpMicroserviceOptions omits tlsOptions when TLS is off', () => {
     
    const mod = require('./rpc-transport');
    const opts = mod.buildTcpMicroserviceOptions('127.0.0.1', 4004);
    expect(opts.options.tlsOptions).toBeUndefined();
    expect(opts.options).toEqual({ host: '127.0.0.1', port: 4004 });
  });

  it('buildTcpClientOptions omits tlsOptions when TLS is off', () => {
     
    const mod = require('./rpc-transport');
    const opts = mod.buildTcpClientOptions('localhost', 4003);
    expect(opts.options.tlsOptions).toBeUndefined();
    expect(opts.options).toEqual({ host: 'localhost', port: 4003 });
  });
});
