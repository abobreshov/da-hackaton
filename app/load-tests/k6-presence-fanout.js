/**
 * k6-presence-fanout.js — presence / liveness fanout proxy.
 *
 * Real WebSocket presence load via k6 (`k6/ws`) is doable but noisy: the BFF
 * gateway requires a signed session cookie + Origin header on the upgrade,
 * and k6's ws module does not share a cookie jar with `http.*`. For the M5
 * demo we approximate fanout pressure with 100 concurrent VUs hammering a
 * cheap GET endpoint while another scenario (k6-message-burst) drives writes.
 *
 * What we measure: p95 of `/api/v1/health` while the system is under load.
 * The threshold (200 ms) reflects "the read path is not starved by writes".
 *
 * Run (after `./dev.sh` is up):
 *   k6 run app/load-tests/k6-presence-fanout.js
 *
 * Override:
 *   BASE_URL=http://localhost:3006/api/v1 ORIGIN=http://localhost:3007 \
 *   k6 run app/load-tests/k6-presence-fanout.js
 *
 * Pair with the burst script in two terminals to observe contention:
 *   term1: k6 run app/load-tests/k6-message-burst.js
 *   term2: k6 run app/load-tests/k6-presence-fanout.js
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3006/api/v1';
const ORIGIN = __ENV.ORIGIN || 'http://localhost:3007';
const HEALTH_PATH = __ENV.HEALTH_PATH || '/health';

const healthLatency = new Trend('health_latency_ms', true);
const healthErrors = new Rate('health_errors');

export const options = {
  scenarios: {
    presence: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '20s', target: 100 },
        { duration: '90s', target: 100 },
        { duration: '10s', target: 0 },
      ],
      gracefulRampDown: '5s',
    },
  },
  thresholds: {
    health_latency_ms: ['p(95)<200'],
    health_errors: ['rate<0.01'],
  },
};

export default function () {
  const res = http.get(BASE_URL + HEALTH_PATH, {
    headers: { Origin: ORIGIN },
    tags: { name: 'health' },
  });
  healthLatency.add(res.timings.duration);
  const ok = check(res, {
    'health 200': (r) => r.status === 200,
  });
  if (!ok) healthErrors.add(1);
  // ~5 req/s per VU → 100 VUs ≈ 500 req/s sustained.
  sleep(0.2);
}

export function handleSummary(data) {
  return {
    stdout: textSummary(data),
    'app/load-tests/last-presence-summary.json': JSON.stringify(data, null, 2),
  };
}

function textSummary(data) {
  const m = data.metrics;
  const get = (name, field) => (m[name] && m[name].values && m[name].values[field]) ?? 'n/a';
  return [
    '',
    '=== k6-presence-fanout summary ===',
    `health p95 (ms):     ${get('health_latency_ms', 'p(95)')}`,
    `health avg (ms):     ${get('health_latency_ms', 'avg')}`,
    `health error rate:   ${get('health_errors', 'rate')}`,
    `http_req_failed:     ${get('http_req_failed', 'rate')}`,
    `iterations:          ${get('iterations', 'count')}`,
    '',
  ].join('\n');
}
