import { makeSub, parseSub, type AccountType } from './claims';

describe('makeSub', () => {
  it('encodes user principals as u:<id>', () => {
    expect(makeSub('user', 7)).toBe('u:7');
  });

  it('encodes admin principals as a:<id>', () => {
    expect(makeSub('admin', 42)).toBe('a:42');
  });

  it('rejects non-positive numeric ids', () => {
    expect(() => makeSub('user', 0)).toThrow(/positive integer/);
    expect(() => makeSub('user', -1)).toThrow(/positive integer/);
    expect(() => makeSub('user', 1.5)).toThrow(/positive integer/);
    expect(() => makeSub('user', Number.NaN)).toThrow(/positive integer/);
  });
});

describe('parseSub', () => {
  it.each<[string, AccountType, number]>([
    ['u:1', 'user', 1],
    ['u:987654321', 'user', 987654321],
    ['a:42', 'admin', 42],
  ])('parses %s → {type: %s, numericId: %i}', (sub, type, numericId) => {
    expect(parseSub(sub)).toEqual({ type, numericId });
  });

  it.each([
    'garbage',
    'u:',
    ':42',
    'u:abc',
    'x:5',
    'u:-5',
    'U:7',          // case-sensitive
    'u: 7',         // whitespace
    '',
    'u:0',          // zero is not a valid id
  ])('throws on malformed sub "%s"', (sub) => {
    expect(() => parseSub(sub)).toThrow();
  });

  it('throws on non-string input', () => {
    expect(() => parseSub(undefined as never)).toThrow(/expected string/);
    expect(() => parseSub(7 as never)).toThrow(/expected string/);
  });

  it('round-trips with makeSub', () => {
    expect(parseSub(makeSub('user', 7))).toEqual({ type: 'user', numericId: 7 });
    expect(parseSub(makeSub('admin', 42))).toEqual({ type: 'admin', numericId: 42 });
  });
});
