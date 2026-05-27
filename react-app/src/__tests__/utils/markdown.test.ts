import { describe, it, expect } from 'vitest';
import { fmtTokens, formatDate } from '../../utils/markdown';

describe('fmtTokens', () => {
  it('returns plain number for small values', () => {
    expect(fmtTokens(0)).toBe('0');
    expect(fmtTokens(999)).toBe('999');
  });

  it('formats thousands with k suffix', () => {
    expect(fmtTokens(1000)).toBe('1k');
    expect(fmtTokens(1500)).toBe('1.5k');
    expect(fmtTokens(10000)).toBe('10k');
    expect(fmtTokens(10500)).toBe('10.5k');
  });

  it('drops trailing .0 for round thousands', () => {
    expect(fmtTokens(2000)).toBe('2k');
    expect(fmtTokens(500000)).toBe('500k');
  });

  it('formats millions with M suffix', () => {
    expect(fmtTokens(1_000_000)).toBe('1M');
    expect(fmtTokens(1_500_000)).toBe('1.5M');
  });
});

describe('formatDate', () => {
  it('returns time string for today', () => {
    const now = Date.now();
    const result = formatDate(now);
    // Should contain colon (time format)
    expect(result).toMatch(/\d{1,2}:\d{2}/);
  });

  it('returns date string for past dates', () => {
    const past = new Date(2020, 0, 15).getTime(); // Jan 15 2020
    const result = formatDate(past);
    expect(result).toMatch(/Jan/);
    expect(result).toMatch(/15/);
  });
});
