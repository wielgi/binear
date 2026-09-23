import { describe, expect, it } from 'vitest';
import { podzielNaTrafienia } from './taskView';

/** Skrot do czytelnych asercji: „ab[cd]ef" znaczy, ze `cd` jest podswietlone. */
const zapis = (text: string, fraza: string) =>
  podzielNaTrafienia(text, fraza)
    .map((k) => (k.hit ? `[${k.text}]` : k.text))
    .join('');

describe('podzielNaTrafienia', () => {
  it('bez frazy oddaje caly tekst jednym kawalkiem', () => {
    expect(podzielNaTrafienia('Tytuł zadania', '')).toEqual([{ text: 'Tytuł zadania', hit: false }]);
    expect(podzielNaTrafienia('Tytuł zadania', '   ')).toEqual([
      { text: 'Tytuł zadania', hit: false },
    ]);
  });

  it('zaznacza trafienie w srodku', () => {
    expect(zapis('Ikony w grupach atrybutów', 'grupa')).toBe('Ikony w [grupa]ch atrybutów');
  });

  it('nie zwaza na wielkosc liter', () => {
    expect(zapis('Automat generujący PIM', 'pim')).toBe('Automat generujący [PIM]');
    expect(zapis('pim i PIM', 'PIM')).toBe('[pim] i [PIM]');
  });

  it('zaznacza wszystkie wystapienia', () => {
    expect(zapis('aXaXa', 'a')).toBe('[a]X[a]X[a]');
  });

  it('radzi sobie z polskimi znakami', () => {
    expect(zapis('Błędne stany', 'błęd')).toBe('[Błęd]ne stany');
  });

  it('traktuje fraze doslownie, nie jako wyrazenie regularne', () => {
    /* Nawiasy i kropki sa w tytulach codziennoscia — jako regex wysadzilyby
       wyszukiwanie albo dopasowaly cokolwiek. */
    expect(zapis('Wersja 2.207.0 (poprawka)', '.207.')).toBe('Wersja 2[.207.]0 (poprawka)');
    expect(zapis('Wersja 2.207.0 (poprawka)', '(poprawka)')).toBe('Wersja 2.207.0 [(poprawka)]');
    expect(zapis('abc', '.')).toBe('abc');
  });

  it('brak trafienia zostawia tekst w calosci', () => {
    expect(podzielNaTrafienia('Tytuł', 'xyz')).toEqual([{ text: 'Tytuł', hit: false }]);
  });

  it('nie gubi ogona po ostatnim trafieniu', () => {
    expect(zapis('raz dwa raz trzy', 'raz')).toBe('[raz] dwa [raz] trzy');
  });
});
