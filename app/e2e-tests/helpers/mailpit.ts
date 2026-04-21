import { expect, request as apiRequest } from '@playwright/test';

const MAILPIT_BASE = process.env.MAILPIT_URL ?? 'http://localhost:8025';
const DEFAULT_TIMEOUT_MS = 9_000;

/**
 * Poll the Mailpit inbox for the newest verification email delivered to
 * `email` and return the 64-hex token from the `verify-email?token=...` link.
 *
 * Shared by every spec that needs to bootstrap a fresh user via the real
 * register → email-verify flow (post-OWASP V3.1.1 the BFF no longer
 * auto-logs-in at /register). Lives here so the m2 + m5 specs don't each
 * carry a copy.
 */
export async function fetchVerifyTokenFromMailpit(
  email: string,
  opts: { timeoutMs?: number } = {},
): Promise<string> {
  const mp = await apiRequest.newContext({ baseURL: MAILPIT_BASE });
  try {
    const tokenRegex = /verify-email\?token=([a-f0-9]{64})/i;
    let token: string | null = null;
    await expect
      .poll(
        async () => {
          const res = await mp.get(`/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
          if (!res.ok()) return null;
          const body = (await res.json()) as { messages?: Array<{ ID: string }> };
          const msgs = body.messages ?? [];
          for (const m of msgs) {
            const full = await mp.get(`/api/v1/message/${m.ID}`);
            if (!full.ok()) continue;
            const detail = (await full.json()) as { HTML?: string; Text?: string };
            const haystack = `${detail.HTML ?? ''}\n${detail.Text ?? ''}`;
            const match = haystack.match(tokenRegex);
            if (match) {
              token = match[1];
              return token;
            }
          }
          return null;
        },
        {
          timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          message: `no verify email for ${email}`,
        },
      )
      .not.toBeNull();
    if (!token) throw new Error('unreachable');
    return token;
  } finally {
    await mp.dispose();
  }
}
