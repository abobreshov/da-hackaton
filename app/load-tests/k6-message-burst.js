/**
 * k6-message-burst.js — message-send burst load.
 *
 * EPIC-11 envelope demo slice: 50 concurrent users login, join the seeded
 * `general` room, and post one message every 500 ms for the duration of the
 * scenario. Reports p95 latency for the message POST and overall error rate.
 *
 * Run (after `./dev.sh` is up + seeded):
 *   k6 run app/load-tests/k6-message-burst.js
 *
 * Override targets / creds via env:
 *   BASE_URL=http://localhost:3006/api/v1 \
 *   ORIGIN=http://localhost:3007 \
 *   USER_EMAIL=user@example.com USER_PASSWORD=User1234! \
 *   ROOM_ID=1 \
 *   k6 run app/load-tests/k6-message-burst.js
 *
 * Note: every VU logs in as the SAME seed user. That is intentional for the
 * smoke-scale demo — see seed-load.sh for how to fan out to N distinct users
 * once the backend exposes a bulk-create endpoint.
 */
import http from 'k6/http';
import { check, sleep, fail } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3006/api/v1';
const ORIGIN = __ENV.ORIGIN || 'http://localhost:3007';
const USER_EMAIL = __ENV.USER_EMAIL || 'user@example.com';
const USER_PASSWORD = __ENV.USER_PASSWORD || 'User1234!';
const ROOM_ID = Number(__ENV.ROOM_ID || '1');
const SEND_INTERVAL_S = Number(__ENV.SEND_INTERVAL_S || '0.5');

const sendLatency = new Trend('msg_send_latency_ms', true);
const sendErrors = new Rate('msg_send_errors');
const sendOk = new Counter('msg_send_ok');

export const options = {
  scenarios: {
    burst: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 50 }, // ramp-up
        { duration: '90s', target: 50 }, // steady state
        { duration: '10s', target: 0 },  // ramp-down
      ],
      gracefulRampDown: '5s',
    },
  },
  thresholds: {
    msg_send_latency_ms: ['p(95)<500'],
    msg_send_errors: ['rate<0.01'],
    http_req_failed: ['rate<0.05'],
  },
};

function jsonHeaders() {
  return {
    'Content-Type': 'application/json',
    Origin: ORIGIN,
    Referer: ORIGIN + '/',
  };
}

export function setup() {
  // Sanity: ping BFF and confirm seeded creds work once before fanning out.
  const probe = http.post(
    BASE_URL + '/auth/login',
    JSON.stringify({ email: USER_EMAIL, password: USER_PASSWORD, type: 'user' }),
    { headers: jsonHeaders() },
  );
  if (probe.status !== 200 && probe.status !== 201) {
    fail(`setup login failed: status=${probe.status} body=${probe.body}`);
  }
  return {};
}

export default function () {
  // Each VU keeps its own cookie jar — k6 gives one per-VU automatically.
  const loginRes = http.post(
    BASE_URL + '/auth/login',
    JSON.stringify({ email: USER_EMAIL, password: USER_PASSWORD, type: 'user' }),
    { headers: jsonHeaders(), tags: { name: 'auth_login' } },
  );
  const loggedIn = check(loginRes, {
    'login 200/201': (r) => r.status === 200 || r.status === 201,
  });
  if (!loggedIn) {
    sendErrors.add(1);
    sleep(1);
    return;
  }

  // Loop: send one message every SEND_INTERVAL_S until the iteration budget
  // (controlled by k6 scenario duration) is up.
  for (let i = 0; i < 200; i++) {
    const payload = JSON.stringify({
      roomId: ROOM_ID,
      body: `[k6-burst] vu=${__VU} iter=${__ITER} i=${i} ts=${Date.now()}`,
    });
    const res = http.post(BASE_URL + '/messages', payload, {
      headers: jsonHeaders(),
      tags: { name: 'msg_send' },
    });
    sendLatency.add(res.timings.duration);
    const ok = check(res, {
      'msg 201': (r) => r.status === 201,
    });
    if (ok) sendOk.add(1);
    else sendErrors.add(1);
    sleep(SEND_INTERVAL_S);
  }
}

export function handleSummary(data) {
  // Default text summary plus a tiny JSON dump alongside the run.
  return {
    stdout: textSummary(data),
    'app/load-tests/last-burst-summary.json': JSON.stringify(data, null, 2),
  };
}

// Inline minimal text summary so the script has zero external deps. k6's
// k6/x/summary helpers are nice-to-have but not bundled into the binary.
function textSummary(data) {
  const m = data.metrics;
  const get = (name, field) => (m[name] && m[name].values && m[name].values[field]) ?? 'n/a';
  return [
    '',
    '=== k6-message-burst summary ===',
    `msg_send p95 (ms):   ${get('msg_send_latency_ms', 'p(95)')}`,
    `msg_send avg (ms):   ${get('msg_send_latency_ms', 'avg')}`,
    `msg_send_ok total:   ${get('msg_send_ok', 'count')}`,
    `msg_send error rate: ${get('msg_send_errors', 'rate')}`,
    `http_req_failed:     ${get('http_req_failed', 'rate')}`,
    `iterations:          ${get('iterations', 'count')}`,
    '',
  ].join('\n');
}
