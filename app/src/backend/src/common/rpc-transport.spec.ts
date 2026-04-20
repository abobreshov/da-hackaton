jest.mock('./../config/environment', () => ({
  env: { SYSTEM_KEY: 'test-system-key-32-char-value-abcde', TLS_ENABLED: false },
}));

import { ExecutionContext } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { SystemKeyRpcGuard, withSys } from './rpc-transport';

function mockRpcContext(data: unknown): ExecutionContext {
  return {
    getType: () => 'rpc',
    switchToRpc: () => ({ getData: () => data }),
  } as unknown as ExecutionContext;
}

function mockHttpContext(): ExecutionContext {
  return { getType: () => 'http' } as unknown as ExecutionContext;
}

describe('SystemKeyRpcGuard', () => {
  const guard = new SystemKeyRpcGuard();

  it('allows RPC call with correct _sys', () => {
    expect(guard.canActivate(mockRpcContext({ _sys: 'test-system-key-32-char-value-abcde', x: 1 }))).toBe(true);
  });

  it('rejects RPC call without _sys', () => {
    expect(() => guard.canActivate(mockRpcContext({ x: 1 }))).toThrow(RpcException);
  });

  it('rejects RPC call with wrong _sys', () => {
    expect(() => guard.canActivate(mockRpcContext({ _sys: 'nope', x: 1 }))).toThrow(RpcException);
  });

  it('rejects RPC call with empty string _sys', () => {
    expect(() => guard.canActivate(mockRpcContext({ _sys: '', x: 1 }))).toThrow(RpcException);
  });

  it('passes through non-RPC contexts (HTTP controllers)', () => {
    expect(guard.canActivate(mockHttpContext())).toBe(true);
  });

  it('rejects RPC call when payload is undefined', () => {
    expect(() => guard.canActivate(mockRpcContext(undefined))).toThrow(RpcException);
  });
});

describe('withSys', () => {
  it('adds _sys field from env without mutating caller payload', () => {
    const original = { email: 'u@x', password: 'pw' };
    const wrapped = withSys(original);
    expect(wrapped).toEqual({ email: 'u@x', password: 'pw', _sys: 'test-system-key-32-char-value-abcde' });
    expect(original).not.toHaveProperty('_sys');
  });

  it('overrides caller-supplied _sys with env value', () => {
    const wrapped = withSys({ _sys: 'spoofed', payload: 'x' } as any);
    expect((wrapped as any)._sys).toBe('test-system-key-32-char-value-abcde');
  });
});
