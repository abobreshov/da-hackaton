/**
 * Prometheus `/metrics` endpoint wiring (auth-service).
 *
 * Default Node + HTTP metrics exposed at root `/metrics` so the observability
 * stack (`app/observability/prometheus.yml`) can scrape it. Route MUST live
 * at `/metrics` — NOT `/api/v1/metrics` — because Prometheus hardcodes the
 * scrape path. `main.ts` excludes `/metrics` from the global `api/v1`
 * prefix; covered by the path-metadata test below.
 */
import 'reflect-metadata';

// AppModule pulls in config/environment.ts which Zod-validates process.env at
// import time. Provide the minimum required vars before requiring AppModule.
process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test';
process.env.SYSTEM_KEY ??= 'a'.repeat(32);
process.env.JWT_ADMIN_SECRET ??= 'b'.repeat(32);
process.env.JWT_CUSTOMER_SECRET ??= 'c'.repeat(32);

import { PrometheusModule, PrometheusController } from '@willsoto/nestjs-prometheus';
import { PATH_METADATA } from '@nestjs/common/constants';
import * as promClient from 'prom-client';

describe('auth-service PrometheusModule wiring', () => {
  // prom-client uses a process-global default registry; collectDefaultMetrics
  // throws on duplicate registration when register() runs twice. Clear it.
  beforeEach(() => promClient.register.clear());

  it('PrometheusModule.register() returns a DynamicModule with the PrometheusController', () => {
    const dyn = PrometheusModule.register();
    expect(dyn.module).toBe(PrometheusModule);
    expect(dyn.controllers).toEqual([PrometheusController]);
  });

  it('default path on the controller is /metrics (root, not api/v1/metrics)', () => {
    PrometheusModule.register();
    const path = Reflect.getMetadata(PATH_METADATA, PrometheusController);
    expect(path).toBe('/metrics');
  });

  it('AppModule includes PrometheusModule in its imports', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AppModule } = require('../../app.module');
    const imports: unknown[] = Reflect.getMetadata('imports', AppModule) ?? [];
    const hasPrometheus = imports.some(
      (i) =>
        i === PrometheusModule ||
        (typeof i === 'object' && i !== null && (i as { module?: unknown }).module === PrometheusModule),
    );
    expect(hasPrometheus).toBe(true);
  });
});
