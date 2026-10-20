import { describe, expect, it } from 'vitest';
import { batchViolation, parseTeams, sameOrigin, withCsp } from './bxProxy';

const req = (headers: Record<string, string>) => ({ headers });

describe('sameOrigin', () => {
  it('przepuszcza brak Origin (curl, ta sama strona bez naglowka) i ten sam adres', () => {
    expect(sameOrigin(req({ host: 'localhost:5181' }))).toBe(true);
    expect(sameOrigin(req({ host: 'localhost:5181', origin: 'http://localhost:5181' }))).toBe(true);
  });

  it('odrzuca inna strone i inny port', () => {
    expect(sameOrigin(req({ host: 'localhost:5181', origin: 'https://evil.example' }))).toBe(false);
    expect(sameOrigin(req({ host: 'localhost:5181', origin: 'http://localhost:5182' }))).toBe(false);
  });
});

describe('batchViolation', () => {
  it('przepuszcza wywolania z allowlisty', () => {
    expect(batchViolation({ halt: 0, cmd: { a: 'tasks.task.list?filter[GROUP_ID]=451', b: 'user.get' } })).toBeNull();
    expect(batchViolation({ cmd: {} })).toBeNull();
  });

  it('odrzuca metode spoza allowlisty i batch w batchu', () => {
    expect(batchViolation({ cmd: { a: 'crm.deal.list' } })).toMatch(/crm\.deal\.list/);
    expect(batchViolation({ cmd: { a: 'batch?cmd[x]=tasks.task.list' } })).toMatch(/batch/);
    expect(batchViolation({ cmd: { a: 'BATCH' } })).toMatch(/BATCH/);
  });

  it('odrzuca wielkosc liter, ktorej nie ma na allowliscie', () => {
    expect(batchViolation({ cmd: { a: 'TASKS.TASK.LIST' } })).not.toBeNull();
  });

  it('odrzuca klucze, ktore Bitrix czyta jako cmd, a sprawdzenie by ominely', () => {
    expect(batchViolation({ 'cmd[x]': 'crm.deal.list' })).toMatch(/klucz/);
    expect(batchViolation({ CMD: { a: 'crm.deal.list' } })).toMatch(/klucz/);
    expect(batchViolation({ ' cmd': { a: 'crm.deal.list' } })).toMatch(/klucz/);
  });

  it('wywolanie, ktore nie jest tekstem, nie przechodzi', () => {
    expect(batchViolation({ cmd: { a: { method: 'tasks.task.list' } } })).not.toBeNull();
  });
});

describe('parseTeams', () => {
  it('brak pliku = pusto, w obu trybach', () => {
    expect(parseTeams(null, false)).toEqual({});
    expect(parseTeams(null, true)).toEqual({});
  });

  it('czyta poprawny plik', () => {
    expect(parseTeams('{"451":{"members":[],"off":{}}}', true)).toEqual({ 451: { members: [], off: {} } });
  });

  it('uszkodzony plik: odczyt daje pusto, zapis rzuca (nie nadpisuje zespolow innych projektow)', () => {
    for (const bad of ['BROKEN{', '[]', 'null', '42']) {
      expect(parseTeams(bad, false)).toEqual({});
      expect(() => parseTeams(bad, true)).toThrow();
    }
  });
});

describe('withCsp', () => {
  it('wstawia polityke zaraz po <head>, takze z atrybutami', () => {
    const out = withCsp('<html><head lang="pl"><title>x</title></head></html>', 'localhost:5181');
    expect(out).toMatch(/^<html><head lang="pl"><meta http-equiv="Content-Security-Policy" content="default-src 'none';/);
    expect(out).toContain('img-src http://localhost:5181 data: https:');
    expect(out).not.toMatch(/script-src/);
  });

  it('<header> to nie <head> — bez <head> nie ma PDF', () => {
    expect(withCsp('<html><body><header>x</header></body></html>', 'localhost:5181')).toBeNull();
  });
});
