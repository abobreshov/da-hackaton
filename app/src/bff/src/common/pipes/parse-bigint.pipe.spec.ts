import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { ParseBigIntPipe } from './parse-bigint.pipe';

describe('ParseBigIntPipe', () => {
  const pipe = new ParseBigIntPipe();
  const meta = { type: 'param', metatype: String, data: 'id' } as any;

  it('passes a plain numeric string through unchanged', () => {
    expect(pipe.transform('42', meta)).toBe('42');
  });

  it('preserves precision beyond Number.MAX_SAFE_INTEGER', () => {
    const big = '9999999999999999999';
    expect(pipe.transform(big, meta)).toBe(big);
  });

  it('rejects empty string', () => {
    expect(() => pipe.transform('', meta)).toThrow(BadRequestException);
  });

  it('rejects non-string input', () => {
    expect(() => pipe.transform(undefined as any, meta)).toThrow(BadRequestException);
  });

  it('rejects negative numbers', () => {
    expect(() => pipe.transform('-1', meta)).toThrow(BadRequestException);
  });

  it('rejects zero (ids start at 1)', () => {
    expect(() => pipe.transform('0', meta)).toThrow(BadRequestException);
  });

  it('rejects leading-zero ids (ambiguous encoding)', () => {
    expect(() => pipe.transform('007', meta)).toThrow(BadRequestException);
  });

  it('rejects floats', () => {
    expect(() => pipe.transform('1.5', meta)).toThrow(BadRequestException);
  });

  it('rejects alpha noise', () => {
    expect(() => pipe.transform('1abc', meta)).toThrow(BadRequestException);
  });
});
