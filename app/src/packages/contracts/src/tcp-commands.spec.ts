import { TcpCmd } from './tcp-commands';

type CmdNode = { [key: string]: string | CmdNode };

function collect(node: CmdNode, values: string[] = []): string[] {
  for (const v of Object.values(node)) {
    if (typeof v === 'string') values.push(v);
    else collect(v as CmdNode, values);
  }
  return values;
}

describe('TcpCmd', () => {
  it('has the expected signature entry auth.customer.login', () => {
    expect(TcpCmd.auth.customer.login).toBe('auth.customer.login');
  });

  it('every command value matches dot-delimited pattern domain.subdomain?.verb', () => {
    // Each segment: identifier starting with lowercase letter (camelCase allowed).
    // Segments are dot-delimited. No spaces, hyphens, underscores, or leading uppercase.
    // 2 to 4 segments total (1 to 3 dots).
    const fullPattern = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*){1,3}$/;
    const values = collect(TcpCmd as unknown as CmdNode);
    expect(values.length).toBeGreaterThan(0);
    for (const v of values) {
      expect(v).toMatch(fullPattern);
      // No segment may start with uppercase; no invalid chars.
      expect(v).not.toMatch(/^[A-Z]/);
      expect(v).not.toMatch(/\.[A-Z]/);
      expect(v).not.toMatch(/[\s_-]/);
      const segments = v.split('.');
      expect(segments.length).toBeGreaterThanOrEqual(2);
      expect(segments.length).toBeLessThanOrEqual(4);
    }
  });

  it('has no duplicate command strings across the entire tree', () => {
    const values = collect(TcpCmd as unknown as CmdNode);
    const seen = new Map<string, number>();
    for (const v of values) seen.set(v, (seen.get(v) ?? 0) + 1);
    const duplicates = [...seen.entries()].filter(([, n]) => n > 1);
    expect(duplicates).toEqual([]);
    expect(new Set(values).size).toBe(values.length);
  });
});
