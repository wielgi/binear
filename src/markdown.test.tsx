import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { renderDescription } from './markdown';

/*
 * Renderujemy do statycznego HTML zamiast montowac w DOM — te testy sprawdzaja
 * KSZTALT wyniku, a nie zachowanie w przegladarce, wiec jsdom byloby zbednym
 * ciezarem. `react-dom` i tak jest w zaleznosciach.
 */
const html = (s: string) => renderToStaticMarkup(<>{renderDescription(s)}</>);

describe('renderDescription — znaki nowej linii', () => {
  /*
   * Regresja z 2026-09-22. Akapit sklejal kolejne linie SPACJA (zachowanie
   * markdowna, gdzie pojedynczy enter to miekkie zawijanie). Komentarz pisany
   * w textarei to nie markdown: Bitrix pokazuje trzy linie, binear pokazywal
   * „line line line".
   */
  it('zachowuje pojedyncze zlamania jako osobne linie', () => {
    const out = html('line\nline\nline');
    expect(out).toContain('<br/>');
    expect(out).not.toContain('line line line');
  });

  it('pusta linia nadal rozdziela akapity', () => {
    const out = html('pierwszy\n\ndrugi');
    expect(out.match(/<p>/g)).toHaveLength(2);
  });

  it('cytat blokowy tez lamie linie', () => {
    expect(html('> jedna\n> druga')).toContain('<br/>');
  });
});

describe('renderDescription — podswietlanie frazy', () => {
  const zFraza = (s: string, fraza: string) =>
    renderToStaticMarkup(<>{renderDescription(s, undefined, fraza)}</>);

  it('bez frazy nie wstawia zadnego <mark>', () => {
    expect(zFraza('Ikony w grupach', '')).not.toContain('<mark>');
  });

  it('zaznacza trafienie w zwyklym tekscie', () => {
    expect(zFraza('Ikony w grupach', 'grupa')).toContain('<mark>grupa</mark>');
  });

  /*
   * Regresja: zerowanie frazy stalo omylkowo w funkcji skladajacej JEDEN akapit,
   * wiec podswietlenie gaslo po pierwszym. Typy tego nie lapia — tylko test.
   */
  it('zaznacza we WSZYSTKICH akapitach, nie tylko w pierwszym', () => {
    const out = zFraza('raz pim\n\ndwa pim\n\ntrzy pim', 'pim');
    expect(out.match(/<mark>/g)).toHaveLength(3);
  });

  it('zaznacza takze wewnatrz pogrubienia i kodu', () => {
    expect(zFraza('**ważne pim**', 'pim')).toContain('<mark>pim</mark>');
    expect(zFraza('`kod pim`', 'pim')).toContain('<mark>pim</mark>');
  });

  it('nie przenosi frazy na kolejne renderowanie', () => {
    zFraza('pim', 'pim');
    expect(zFraza('pim', '')).not.toContain('<mark>');
  });
});

describe('renderDescription — bezpieczenstwo i podstawy', () => {
  it('nie wstawia surowego HTML-a z tresci', () => {
    expect(html('<img src=x onerror=alert(1)>')).not.toContain('<img');
  });

  it('mapuje naglowki na h3/h4, bo h1 nalezy do tytulu zadania', () => {
    expect(html('# Tytuł')).toBe('<h3>Tytuł</h3>');
    expect(html('## Tytuł')).toBe('<h3>Tytuł</h3>');
    expect(html('### Tytuł')).toBe('<h4>Tytuł</h4>');
  });

  it('rozpoznaje liste', () => {
    expect(html('- raz\n- dwa')).toContain('<li>');
  });

  it('nie zawiesza sie na wierszu tabeli bez separatora', () => {
    /* Historyczna petla nieskonczona: linia `|…|` wygladala na blok, ale zaden
       blok jej nie przyjmowal i indeks nie ruszal z miejsca. */
    expect(() => html('| a | b |\nzwykły tekst')).not.toThrow();
  });
});
