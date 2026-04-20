/**
 * Contracts grep-gate.
 *
 * Prevents inline wire-string drift away from `@app/contracts`. If a file
 * under `app/src/{bff,backend,auth-service,frontend}/src/**` contains a
 * string literal that exactly matches one of the exported `TcpCmd`,
 * `WsEvent.client`, `WsEvent.server`, or `QueueName` values, the file MUST
 * either import from `@app/contracts` or be allow-listed below.
 *
 * Scope — only exact matches on quoted literals (`'foo.bar'` / `"foo.bar"`).
 * Audit-log `action` enums and BullMQ queue job names that happen to look
 * similar are handled via their own enums and fall outside the TCP/WS/Queue
 * contract surface.
 *
 * Failing this test means one of:
 *   1. A new feature introduced an inline wire literal → import from
 *      `@app/contracts` instead.
 *   2. Pre-existing drift was cleaned up → remove the file from
 *      `ALLOW_LIST` below.
 *   3. A new literal was added to contracts that collides with an existing
 *      value in a non-contracts file → add the file to `ALLOW_LIST` with a
 *      ticket reference and plan to migrate.
 */

import * as fs from 'fs';
import * as path from 'path';
import { TcpCmd } from '../tcp-commands';
import { WsEvent } from '../ws-events';
import { QueueName } from '../queues';

// --- Allow-list: pre-existing drift. Key = repo-relative file path, value =
// expected set of inline literals in that file. Any new drift (file not
// listed OR listed file has new literals) fails the gate.
//
// Drift inventory as of 2026-04-20 — see commit backlog for cleanup waves.
const ALLOW_LIST: Record<string, string[]> = {
  'app/src/bff/src/auth/auth.service.ts': [
    'auth.admin.login',
    'auth.admin.logout',
    'auth.admin.refresh',
    'auth.customer.delete',
    'auth.customer.login',
    'auth.customer.logout',
    'auth.customer.passwordChange',
    'auth.customer.passwordReset.confirm',
    'auth.customer.passwordReset.request',
    'auth.customer.refresh',
    'auth.customer.register',
    'auth.customer.validateToken',
  ],
  'app/src/backend/src/common/guards/jwt.guard.ts': [
    'auth.customer.validateToken',
  ],
  'app/src/backend/src/modules/audit/audit.controller.ts': [
    'auth.customer.validateToken',
  ],
  'app/src/backend/src/modules/bans/bans.service.ts': [
    'dm.frozen',
    'friend.removed',
  ],
  'app/src/backend/src/modules/friends/friends.service.ts': [
    'friend.removed',
    'friend.request.accepted',
    'friend.request.new',
  ],
  'app/src/backend/src/modules/users/users.tcp.ts': [
    'users.findById',
    'users.findByUsername',
    'users.list',
  ],
  'app/src/backend/src/workers/queue.producer.ts': [
    'abuse.report.notify',
    'attachments.cleanup',
    'retention.prune',
    'user.cascade.delete',
  ],
  'app/src/auth-service/src/modules/auth/admin/admin-auth.tcp.ts': [
    'auth.admin.login',
    'auth.admin.logout',
    'auth.admin.refresh',
  ],
};

// --- Repo root = four levels up from this spec (src/gate/inline-drift.spec.ts
// -> src/gate -> src -> contracts -> packages -> src -> app -> repo root).
// But the tree we scan lives under `app/src/...`. Resolve the hackathone
// repo root by walking up until we see `app/` + `mng/` siblings.
function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 10; i++) {
    if (
      fs.existsSync(path.join(dir, 'app')) &&
      fs.existsSync(path.join(dir, 'mng'))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`could not locate repo root starting from ${start}`);
}

const REPO_ROOT = findRepoRoot(__dirname);

const TARGET_ROOTS = [
  'app/src/bff/src',
  'app/src/backend/src',
  'app/src/auth-service/src',
  'app/src/frontend/src',
];

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.vite',
  '.turbo',
]);

function isTestFile(p: string): boolean {
  return /\.(spec|test)\.tsx?$/.test(p);
}

function isSourceFile(p: string): boolean {
  return /\.(ts|tsx)$/.test(p) && !isTestFile(p);
}

function* walk(dir: string): IterableIterator<string> {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(p);
    } else if (entry.isFile()) {
      yield p;
    }
  }
}

// Recursively collect every string leaf from a nested const object like
// `TcpCmd` or `WsEvent` into a Set. Values of other types are ignored.
function collectLiterals(obj: unknown, sink: Set<string>): void {
  if (typeof obj === 'string') {
    sink.add(obj);
    return;
  }
  if (obj && typeof obj === 'object') {
    for (const v of Object.values(obj as Record<string, unknown>)) {
      collectLiterals(v, sink);
    }
  }
}

function buildWireLiteralSet(): Set<string> {
  const set = new Set<string>();
  collectLiterals(TcpCmd, set);
  collectLiterals(WsEvent.client, set);
  collectLiterals(WsEvent.server, set);
  collectLiterals(QueueName, set);
  // Drop single-segment literals (no dot) — they collide with common
  // English words (e.g. `WsEvent.server.error === 'error'` is used by
  // Node EventEmitter, socket.io, status-enum unions, etc.). Dot-separated
  // identifiers are unambiguous wire strings.
  for (const lit of [...set]) {
    if (!lit.includes('.')) set.delete(lit);
  }
  return set;
}

function hasContractsImport(content: string): boolean {
  return /from\s+['"]@app\/contracts['"]/.test(content);
}

function literalsUsedIn(content: string, literals: Set<string>): string[] {
  const hits: string[] = [];
  for (const lit of literals) {
    if (content.includes(`'${lit}'`) || content.includes(`"${lit}"`)) {
      hits.push(lit);
    }
  }
  return hits.sort();
}

interface DriftEntry {
  file: string;
  literals: string[];
}

function scanForDrift(literals: Set<string>): DriftEntry[] {
  const drift: DriftEntry[] = [];
  for (const rel of TARGET_ROOTS) {
    const absRoot = path.join(REPO_ROOT, rel);
    for (const abs of walk(absRoot)) {
      if (!isSourceFile(abs)) continue;
      const content = fs.readFileSync(abs, 'utf8');
      if (hasContractsImport(content)) continue;
      const hits = literalsUsedIn(content, literals);
      if (hits.length === 0) continue;
      const relFromRepo = path.relative(REPO_ROOT, abs).split(path.sep).join('/');
      drift.push({ file: relFromRepo, literals: hits });
    }
  }
  drift.sort((a, b) => a.file.localeCompare(b.file));
  return drift;
}

// Normalise drift against the allow-list into actionable diffs so assertion
// failures point at the offending file(s) rather than a 400-line blob.
interface DiffReport {
  unexpectedFiles: DriftEntry[];
  resolvedFiles: string[];
  changedHits: Array<{
    file: string;
    extraLiterals: string[];
    missingLiterals: string[];
  }>;
}

function diffAgainstAllowList(drift: DriftEntry[]): DiffReport {
  const report: DiffReport = {
    unexpectedFiles: [],
    resolvedFiles: [],
    changedHits: [],
  };
  const driftByFile = new Map(drift.map((d) => [d.file, d.literals]));

  for (const d of drift) {
    const allowed = ALLOW_LIST[d.file];
    if (!allowed) {
      report.unexpectedFiles.push(d);
      continue;
    }
    const allowedSet = new Set(allowed);
    const actualSet = new Set(d.literals);
    const extra = d.literals.filter((x) => !allowedSet.has(x));
    const missing = allowed.filter((x) => !actualSet.has(x));
    if (extra.length || missing.length) {
      report.changedHits.push({
        file: d.file,
        extraLiterals: extra.sort(),
        missingLiterals: missing.sort(),
      });
    }
  }

  for (const file of Object.keys(ALLOW_LIST)) {
    if (!driftByFile.has(file)) report.resolvedFiles.push(file);
  }

  return report;
}

describe('contracts grep-gate: inline wire-string drift', () => {
  const literals = buildWireLiteralSet();

  it('has a non-empty wire-literal set', () => {
    // Sanity check — if contracts goes empty, the gate would silently pass.
    expect(literals.size).toBeGreaterThan(0);
  });

  it('no new drift outside the documented allow-list', () => {
    const drift = scanForDrift(literals);
    const diff = diffAgainstAllowList(drift);

    const problems: string[] = [];

    for (const e of diff.unexpectedFiles) {
      problems.push(
        `NEW drift — ${e.file} uses inline wire literal(s): ${e.literals.join(', ')}\n` +
          `    Fix: import from '@app/contracts' and reference TcpCmd / WsEvent / QueueName.`,
      );
    }

    for (const c of diff.changedHits) {
      if (c.extraLiterals.length) {
        problems.push(
          `ADDED drift in ${c.file}: ${c.extraLiterals.join(', ')}\n` +
            `    Fix: import from '@app/contracts' instead of inlining, or extend the allow-list entry.`,
        );
      }
      if (c.missingLiterals.length) {
        problems.push(
          `RESOLVED drift in ${c.file}: ${c.missingLiterals.join(', ')}\n` +
            `    Fix: trim those entries from the gate's ALLOW_LIST now that the file is clean.`,
        );
      }
    }

    for (const f of diff.resolvedFiles) {
      problems.push(
        `RESOLVED file ${f} — no inline literals detected.\n` +
          `    Fix: remove the entry from the gate's ALLOW_LIST.`,
      );
    }

    if (problems.length) {
      throw new Error(
        `\nContracts grep-gate found ${problems.length} issue(s):\n\n` +
          problems.map((p, i) => `  ${i + 1}. ${p}`).join('\n\n') +
          '\n',
      );
    }
  });

  it('allow-list matches actual drift exactly (no stale entries)', () => {
    const drift = scanForDrift(literals);
    const actual: Record<string, string[]> = {};
    for (const d of drift) actual[d.file] = [...d.literals].sort();

    const normalisedAllow: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(ALLOW_LIST)) {
      normalisedAllow[k] = [...v].sort();
    }

    expect(actual).toEqual(normalisedAllow);
  });
});
