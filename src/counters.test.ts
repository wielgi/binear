import { describe, expect, it } from 'vitest';
import {
  answerState,
  countAll,
  previousDay,
  recordDay,
  type ChatMessage,
  type CounterCtx,
} from './counters';

const zadanie = (o: Partial<Parameters<typeof countAll>[0][number]> & { id: number }) => ({
  status: '2',
  sprintId: null,
  tags: [],
  storyPoints: null,
  epicId: 141,
  ...o,
});

const ctx = (o: Partial<CounterCtx> = {}): CounterCtx => ({
  sprintId: 70,
  closed: new Set(['5']),
  answered: new Set(),
  ...o,
});

describe('countAll', () => {
  const lista = [
    zadanie({ id: 1, sprintId: 70, storyPoints: 8 }),
    zadanie({ id: 2, sprintId: 70, storyPoints: 4, status: '5' }),
    zadanie({ id: 3, tags: ['DO-STARTU'] }),
    zadanie({ id: 4, tags: ['do-startu'], storyPoints: 6 }),
    zadanie({ id: 5, tags: ['DO-STARTU'], sprintId: 70 }),
    zadanie({ id: 6, tags: ['OCZEKUJE-NA-ODPOWIEDZ'] }),
    zadanie({ id: 7, tags: ['OCZEKUJE-NA-ODPOWIEDZ'] }),
    zadanie({ id: 8, tags: ['DO-WYWIADU'], epicId: null }),
    zadanie({ id: 9, status: '5', epicId: null, tags: ['DO-WYWIADU'] }),
    zadanie({ id: 10, sprintId: 69 }),
  ];
  const wynik = countAll(lista, ctx({ answered: new Set([7]) }));

  it('sprint liczy tez zakonczone i sumuje ich story pointy', () => {
    expect(wynik.sprint).toEqual({ count: 3, points: 12 });
  });

  it('poza sprintem to otwarte spoza AKTYWNEGO sprintu, takze z innych sprintow', () => {
    expect(wynik.poza.count).toBe(6);
  });

  it('do wyceny: DO-STARTU poza sprintem bez story pointow, bez wzgledu na wielkosc liter tagu', () => {
    expect(wynik.wycena.count).toBe(1);
  });

  it('do analizy: tylko OCZEKUJE z odpowiedzia', () => {
    expect(wynik.odpowiedzi.count).toBe(1);
  });

  it('wywiad i epik pomijaja zamkniete', () => {
    expect(wynik.wywiad.count).toBe(1);
    expect(wynik.epik.count).toBe(1);
  });

  it('bez aktywnego sprintu wszystko otwarte jest poza sprintem', () => {
    expect(countAll(lista, ctx({ sprintId: null })).poza.count).toBe(8);
  });

  it('odlozone wypadaja z kart audytu, ale zostaja w rejestrze poza sprintem', () => {
    const odlozone = [
      zadanie({ id: 20, status: '6', tags: ['DO-WYWIADU'], epicId: null }),
      zadanie({ id: 21, status: '6', tags: ['OCZEKUJE-NA-ODPOWIEDZ'] }),
      zadanie({ id: 22, status: '6', tags: ['DO-STARTU'] }),
    ];
    const w = countAll(odlozone, ctx({ answered: new Set([21]) }));
    expect([w.wywiad.count, w.epik.count, w.odpowiedzi.count, w.wycena.count]).toEqual([0, 0, 0, 0]);
    expect(w.poza.count).toBe(3);
  });

  it('odpowiedzi jeszcze nieprzeliczone daja zero, a nie blad', () => {
    expect(countAll(lista, ctx({ answered: null })).odpowiedzi.count).toBe(0);
  });
});

describe('answerState', () => {
  const IT = new Set([251, 28]);
  const isIt = (id: number) => IT.has(id);
  const msg = (id: number, authorId: number, text = 'tekst'): ChatMessage => ({ id, authorId, text });
  const PYTANIA = '[B]1. Kto to robi?[/B]\nOpis\n\n[B]2. Jak czesto?[/B]';

  it('bez komentarza z pytaniami nie ma kotwicy', () => {
    expect(answerState([msg(1, 108), msg(2, 251, 'zwykly komentarz')], isIt)).toBe('no-question');
  });

  it('odpowiedz osoby spoza IT po pytaniach', () => {
    expect(answerState([msg(1, 251, PYTANIA), msg(2, 108, 'Robi to magazyn')], isIt)).toBe('answered');
  });

  it('wpis systemowy i komentarz z IT to nie odpowiedz', () => {
    expect(answerState([msg(1, 251, PYTANIA), msg(2, 0, 'Zmiana etapu'), msg(3, 28, 'ping')], isIt)).toBe(
      'waiting',
    );
  });

  it('kolejna runda pytan przesuwa kotwice', () => {
    const czat = [msg(1, 251, PYTANIA), msg(2, 108, 'odpowiedz'), msg(3, 251, PYTANIA)];
    expect(answerState(czat, isIt)).toBe('waiting');
  });

  it('pytania zadane przez kogos spoza IT nie sa kotwica', () => {
    expect(answerState([msg(1, 108, PYTANIA), msg(2, 109, 'ok')], isIt)).toBe('no-question');
  });
});

describe('historia dzien po dniu', () => {
  it('scala klucze dnia i odcina najstarsze dni', () => {
    let h = recordDay({}, '2026-09-26', { poza: 200 }, 2);
    h = recordDay(h, '2026-09-27', { poza: 210 }, 2);
    h = recordDay(h, '2026-09-28', { poza: 220 }, 2);
    h = recordDay(h, '2026-09-28', { wywiad: 5 }, 2);
    expect(h).toEqual({ '2026-09-27': { poza: 210 }, '2026-09-28': { poza: 220, wywiad: 5 } });
  });

  it('punktem odniesienia jest ostatni zapisany dzien przed dzisiejszym, nawet z przerwa', () => {
    const h = { '2026-09-20': { poza: 190 }, '2026-09-25': { poza: 205 }, '2026-09-28': { poza: 220 } };
    expect(previousDay(h, '2026-09-28')).toEqual({ day: '2026-09-25', snap: { poza: 205 } });
    expect(previousDay(h, '2026-09-20')).toBeNull();
  });
});
