/**
 * ValidationPipe options for backend — extracted to a dedicated module so the
 * startup invariant can be unit-tested without mounting the full Nest DI graph
 * (which `import '../main'` would trigger via the side-effecting `bootstrap()`
 * call).
 *
 * The backend HTTP surface is fronted by the BFF whose callers may evolve to
 * send extra fields; there is no benefit to crashing on them, and — identical
 * to auth-service — the shared-secret `_sys` envelope rides on TCP payloads.
 * A `console.assert` would only *log* on misconfiguration; we throw at
 * module-load time instead, aborting startup cold.
 */
export const validationPipeOptions = {
  whitelist: true,
  transform: true,
} as const;

export function assertNoForbidNonWhitelisted(opts: Readonly<Record<string, unknown>>): void {
  if ('forbidNonWhitelisted' in opts) {
    throw new Error(
      'backend ValidationPipe MUST NOT set forbidNonWhitelisted — keep the HTTP surface forward-compatible and preserve the `_sys` RPC envelope',
    );
  }
}

assertNoForbidNonWhitelisted(validationPipeOptions);
