/**
 * Prometheus `/metrics` endpoint wiring.
 *
 * The backend exposes Node + HTTP default metrics at root `/metrics` so the
 * observability stack (`app/observability/prometheus.yml`) can scrape it.
 * The route MUST live at `/metrics` — NOT `/api/v1/metrics` — because
 * `prometheus.yml` hardcodes `metrics_path: /metrics`. `main.ts` excludes
 * `/metrics` from the global `api/v1` prefix; verified in a dedicated test
 * below so a future edit that drops the exclusion fails loud.
 */
import 'reflect-metadata';

// AppModule pulls in config/environment.ts which Zod-validates process.env at
// import time. Set the minimum it needs before requiring AppModule below.
process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test';
process.env.SYSTEM_KEY ??= 'a'.repeat(32);

import { PrometheusModule, PrometheusController } from '@willsoto/nestjs-prometheus';
import { PATH_METADATA } from '@nestjs/common/constants';
import * as promClient from 'prom-client';

describe('backend PrometheusModule wiring', () => {
  // prom-client uses a process-global default registry; calling
  // PrometheusModule.register() more than once in the same process re-runs
  // collectDefaultMetrics which throws on duplicate metric registration.
  // Clear before each call so individual cases stay isolated.
  beforeEach(() => promClient.register.clear());

  it('PrometheusModule.register() returns a DynamicModule with the PrometheusController', () => {
    const dyn = PrometheusModule.register();
    expect(dyn.module).toBe(PrometheusModule);
    expect(dyn.controllers).toEqual([PrometheusController]);
  });

  it('default path on the controller is /metrics (root, not api/v1/metrics)', () => {
    // Triggers PrometheusModule.configureServer which sets the path metadata.
    PrometheusModule.register();
    const path = Reflect.getMetadata(PATH_METADATA, PrometheusController);
    expect(path).toBe('/metrics');
  });

  it('AppModule includes PrometheusModule in its imports', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AppModule } = require('../../app.module');
    const imports: unknown[] = Reflect.getMetadata('imports', AppModule) ?? [];
    // PrometheusModule.register() returns a DynamicModule object, so match
    // on the `.module` pointer rather than identity against the class.
    const hasPrometheus = imports.some(
      (i) =>
        i === PrometheusModule ||
        (typeof i === 'object' && i !== null && (i as { module?: unknown }).module === PrometheusModule),
    );
    expect(hasPrometheus).toBe(true);
  });
});
