import { describe, expect, it } from 'vitest';
import { kafelkow, zadan } from './plural';

describe('pl', () => {
  it('1 / 2–4 / 5+ / 12–14 / 22', () => {
    expect([1, 2, 4, 5, 12, 14, 22, 25].map(zadan)).toEqual([
      '1 zadanie',
      '2 zadania',
      '4 zadania',
      '5 zadań',
      '12 zadań',
      '14 zadań',
      '22 zadania',
      '25 zadań',
    ]);
    expect(kafelkow(10)).toBe('10 kafelków');
  });
});
