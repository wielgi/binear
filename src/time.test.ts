import { describe, expect, it } from 'vitest';
import { clampWorkingMs, spansMultipleDays, sumIntervalsMs, type Interval } from './bitrix';

/*
 * Cala arytmetyka „ile czasu zajelo zadanie". Daty budujemy konstruktorem
 * lokalnym (`new Date(r, m, d, g)`), zeby testy nie zalezaly od strefy maszyny —
 * `clampWorkingMs` tez liczy okno pracy w strefie lokalnej.
 */
const h = (rok: number, mies: number, dzien: number, godz: number, min = 0) =>
  new Date(rok, mies - 1, dzien, godz, min, 0, 0).getTime();

/** 2026-09-21 to poniedzialek, 2026-09-26 sobota, 2026-09-27 niedziela. */
const odcinek = (a: number, b: number): Interval => ({ start: a, end: b });

describe('sumIntervalsMs', () => {
  it('sumuje odcinki', () => {
    const suma = sumIntervalsMs([
      odcinek(h(2026, 9, 21, 8), h(2026, 9, 21, 10)),
      odcinek(h(2026, 9, 21, 12), h(2026, 9, 21, 13)),
    ]);
    expect(suma / 3600000).toBe(3);
  });

  it('ignoruje odcinek odwrocony zamiast odejmowac', () => {
    expect(sumIntervalsMs([odcinek(h(2026, 9, 21, 10), h(2026, 9, 21, 8))])).toBe(0);
  });
});

describe('clampWorkingMs', () => {
  it('liczy przyklad z dokumentacji: 15:00 → 9:00 nastepnego dnia to 2 h', () => {
    const ms = clampWorkingMs([odcinek(h(2026, 9, 21, 15), h(2026, 9, 22, 9))]);
    expect(ms / 3600000).toBe(2);
  });

  it('pomija weekend w calosci', () => {
    /* Piatek 25.09 12:00 → poniedzialek 28.09 12:00.
       Piatek 12-16 = 4 h, poniedzialek 8-12 = 4 h, sobota i niedziela = 0. */
    const ms = clampWorkingMs([odcinek(h(2026, 9, 25, 12), h(2026, 9, 28, 12))]);
    expect(ms / 3600000).toBe(8);
  });

  it('noc miedzy dniami roboczymi nie jest naliczana', () => {
    /* Pelna doba od poniedzialku 8:00 daje jeden dzien pracy, nie 24 h. */
    const ms = clampWorkingMs([odcinek(h(2026, 9, 21, 8), h(2026, 9, 22, 8))]);
    expect(ms / 3600000).toBe(8);
  });

  it('respektuje wlasne godziny pracy', () => {
    const o = [odcinek(h(2026, 9, 21, 6), h(2026, 9, 21, 20))];
    expect(clampWorkingMs(o, 7, 14) / 3600000).toBe(7);
  });

  it('odcinek w calosci poza godzinami pracy daje zero', () => {
    expect(clampWorkingMs([odcinek(h(2026, 9, 21, 19), h(2026, 9, 21, 22))])).toBe(0);
  });

  it('odcinek w calosci w weekend daje zero', () => {
    expect(clampWorkingMs([odcinek(h(2026, 9, 26, 9), h(2026, 9, 27, 15))])).toBe(0);
  });
});

describe('spansMultipleDays', () => {
  it('rozpoznaje odcinek przechodzacy przez polnoc', () => {
    expect(spansMultipleDays([odcinek(h(2026, 9, 21, 23), h(2026, 9, 22, 1))])).toBe(true);
  });

  it('krotki odcinek w jednym dniu to nie jest kilka dni', () => {
    expect(spansMultipleDays([odcinek(h(2026, 9, 21, 9), h(2026, 9, 21, 17))])).toBe(false);
  });
});
