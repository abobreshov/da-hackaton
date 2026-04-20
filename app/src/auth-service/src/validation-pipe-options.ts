/**
 * ValidationPipe options for auth-service — extracted to a dedicated module so
 * the startup invariant can be unit-tested without mounting the full Nest DI
 * graph (which `import '../main'` would trigger via the side-effecting
 * `bootstrap()` call).
 *
 * The invariant is load-bearing: the shared-secret RPC envelope (`_sys`) rides
 * along on every TCP payload and would otherwise be rejected before
 * `SystemKeyRpcGuard` can read it. A `console.assert` would only *log* on
 * misconfiguration — silent boot is indistinguishable from green boot — so we
 * throw at module-load time instead, aborting startup cold.
 */
export const validationPipeOptions = {
  whitelist: true,
  transform: true,
} as const;

export function assertNoForbidNonWhitelisted(opts: Readonly<Record<string, unknown>>): void {
  if ('forbidNonWhitelisted' in opts) {
    throw new Error(
      'auth-service ValidationPipe MUST NOT set forbidNonWhitelisted — _sys guard reads the key before validation strips it',
    );
  }
}

// Enforced at module load — re-exported constant triggers the check once on
// first import and again (no-op) on hot-reload.
assertNoForbidNonWhitelisted(validationPipeOptions);
