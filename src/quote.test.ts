import { describe, expect, it } from 'vitest';
import { buildQuote, plainText, splitQuote } from './quote';

/*
 * Cytat jest jedyna czescia binear, ktora POTRAFI ZEPSUC cudzy komentarz
 * w Bitriksie. Przy edycji zapisujemy `raw + tresc z pola` (patrz `saveEdit`),
 * wiec zly rozbior nie tylko brzydko wyglada — trwale zmienia komentarz.
 * Stad nacisk na niezmiennik odtwarzalnosci, a nie tylko na ladny wynik.
 */

/** Prawdziwy cytat z portalu (zadanie z grupy 451), przepisany znak w znak. */
const PRAWDZIWY =
  '------------------------------------------------------\n' +
  'Łukasz Kościk [wczoraj, 17:49] #chat26721/5968735\n' +
  '2. Te same rodziny dla wszystkich kanałów\n' +
  'Nie rozumiem?\n' +
  '------------------------------------------------------\n' +
  'jeżeli na 1 odpowiedziałeś nie to nie ma znaczenia';

describe('splitQuote', () => {
  it('zostawia zwykly komentarz nietkniety', () => {
    const t = 'Zwykły komentarz\nz dwiema liniami';
    expect(splitQuote(t)).toEqual({ quote: null, rest: t, raw: '' });
  });

  it('rozbija prawdziwy cytat z Bitriksa', () => {
    const { quote, rest } = splitQuote(PRAWDZIWY);
    expect(quote?.author).toBe('Łukasz Kościk');
    expect(quote?.when).toBe('wczoraj, 17:49');
    expect(quote?.body).toBe('2. Te same rodziny dla wszystkich kanałów\nNie rozumiem?');
    expect(rest).toBe('jeżeli na 1 odpowiedziałeś nie to nie ma znaczenia');
  });

  it('rozbija wlasny cytat binear, ktory nie ma kotwicy #chat', () => {
    const t = buildQuote('Wojciech Szyper', '22 wrz 09:15', 'cytowana treść') + 'moja odpowiedź';
    const { quote, rest } = splitQuote(t);
    expect(quote?.author).toBe('Wojciech Szyper');
    expect(quote?.body).toBe('cytowana treść');
    expect(rest).toBe('moja odpowiedź');
  });

  /*
   * NAJWAZNIEJSZY test w tym pliku. `saveEdit` sklada komentarz jako
   * `raw + tresc`, wiec dopoki `raw` niesie caly blok cytatu, zadna pomylka
   * w rozbiorze nie moze go skasowac.
   */
  it('raw + rest odtwarza tresc oryginalu', () => {
    for (const t of [PRAWDZIWY, buildQuote('A', '10:00', 'x') + 'y']) {
      const { rest, raw } = splitQuote(t);
      expect((raw + rest).replace(/\s+/g, ' ').trim()).toBe(t.replace(/\s+/g, ' ').trim());
    }
  });

  it('nie zgaduje, gdy brakuje kreski zamykajacej', () => {
    const t = '------------------------------------------------------\nAutor [10:00]\nurwane';
    expect(splitQuote(t).quote).toBeNull();
    expect(splitQuote(t).rest).toBe(t);
  });

  it('nie zjada linii tresci, ktora tylko WYGLADA na naglowek', () => {
    /* „Poprawka [zrobione]" konczy sie nawiasem, ale nie ma godziny — to tresc. */
    const t = buildQuote('Autor', '09:30', 'Poprawka [zrobione]\ndruga linia') + 'odp';
    const { quote } = splitQuote(t);
    expect(quote?.author).toBe('Autor');
    expect(quote?.body).toBe('Poprawka [zrobione]\ndruga linia');
  });

  it('zdejmuje cudzyslow z cytatu zaznaczenia', () => {
    const t = buildQuote('Autor', '09:30', '"zaznaczony fragment"') + 'odp';
    expect(splitQuote(t).quote?.body).toBe('zaznaczony fragment');
  });

  it('NIE okalecza tresci z dwoma cudzyslowami w srodku', () => {
    const t = buildQuote('Autor', '09:30', '"a" oraz "b"') + 'odp';
    expect(splitQuote(t).quote?.body).toBe('"a" oraz "b"');
  });
});

describe('plainText', () => {
  it('zdejmuje znaczniki Bitriksa, zostawiajac czytelna tresc', () => {
    expect(plainText('[USER=387]Anna[/USER] zobacz [URL=http://x]tutaj[/URL]')).toBe(
      'Anna zobacz tutaj',
    );
  });

  it('skleja biale znaki do jednej linii', () => {
    expect(plainText('a\n\n  b\tc')).toBe('a b c');
  });
});
