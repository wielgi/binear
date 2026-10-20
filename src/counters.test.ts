import { describe, expect, it } from 'vitest';
import {
  answerState,
  foldersOf,
  hasReconMarker,
  hasValueMessage,
  pula,
  isCompleteByTags,
  isReconByTitle,
  needsChat,
  paybackBand,
  paybackRank,
  isSubstantiveAnswer,
  MIN_ANSWER_CHARS,
  plainBody,
  previousDay,
  readiness,
  recordDay,
  type ChatMessage,
  type ChatFacts,
} from './counters';

const zadanie = (o: Partial<Parameters<typeof readiness>[0]> & { id: number }) => ({
  status: '2',
  sprintId: null,
  tags: [],
  storyPoints: null,
  epicId: 141,
  priority: '1',
  title: 'Zadanie',
  deadline: null as string | null,
  ...o,
});

/*
 * Gotowe albo do wyceny wg `readiness` — w tej samej postaci [do wyceny, gotowe] co dawniej kafelki. Gdy
 * rozstrzyga nieprzeczytany jeszcze czat (`ready: null`), zadanie nie jest gotowe — tak jak dawniej.
 */
const BEZ_FAKTOW: ChatFacts = { recon: new Set(), value: new Set(), read: new Set([100, 200, 300, 1]) };
const wg = (t: ReturnType<typeof zadanie>, chat: ChatFacts | null) => (readiness(t, chat).ready === true ? [0, 1] : [1, 0]);


describe('gotowosc do startu', () => {
  describe('komplet do startu: pula, wycena, kategoria i tag okresu zwrotu', () => {
    const TERMIN = '2026-11-01T00:00:00+02:00';
    const start = (o: Partial<Parameters<typeof zadanie>[0]> = {}) =>
      zadanie({ id: 100, tags: ['DO-STARTU', 'DZIAL', 'OSZCZEDNOSC', 'ZWROT-6'], storyPoints: 6, ...o });
    const stan = (t: ReturnType<typeof zadanie>) => wg(t, BEZ_FAKTOW);

    it('wycena + kategoria + tag zwrotu → gotowe do startu', () => {
      expect(stan(start())).toEqual([0, 1]);
    });

    it('bez story pointow → do wyceny', () => {
      expect(stan(start({ storyPoints: null }))).toEqual([1, 0]);
    });

    it('bez kategorii → do wyceny, choc ma wycene i tag zwrotu', () => {
      expect(stan(start({ tags: ['DO-STARTU', 'DZIAL', 'ZWROT-6'] }))).toEqual([1, 0]);
    });

    it('bez tagu zwrotu → do wyceny', () => {
      expect(stan(start({ tags: ['DO-STARTU', 'DZIAL', 'OSZCZEDNOSC'] }))).toEqual([1, 0]);
    });

    it('kazdy z czterech tagow zwrotu wystarcza, takze bez wzgledu na wielkosc liter', () => {
      for (const tag of ['ZWROT-3', 'zwrot-6', 'Zwrot-12', 'ZWROT-12+']) {
        expect(stan(start({ tags: ['DO-STARTU', 'DZIAL', 'RYZYKO', tag] }))).toEqual([0, 1]);
      }
    });

    it('tag zwrotu spoza listy (ZWROT-24) zwrotu nie daje', () => {
      expect(stan(start({ tags: ['DO-STARTU', 'DZIAL', 'RYZYKO', 'ZWROT-24'] }))).toEqual([1, 0]);
    });

    it('WYMOG nie potrzebuje okresu zwrotu, ale MUSI miec termin', () => {
      expect(stan(start({ tags: ['DO-STARTU', 'DZIAL', 'WYMOG'], deadline: TERMIN }))).toEqual([0, 1]);
      expect(stan(start({ tags: ['DO-STARTU', 'DZIAL', 'WYMOG'], deadline: null }))).toEqual([1, 0]);
    });

    it('WYMOG z terminem, ale bez wyceny → do wyceny', () => {
      expect(stan(start({ tags: ['DO-STARTU', 'DZIAL', 'WYMOG'], storyPoints: null, deadline: TERMIN }))).toEqual([1, 0]);
    });

    it('termin nie zastepuje tagu zwrotu zwyklego zadania', () => {
      expect(stan(start({ tags: ['DO-STARTU', 'DZIAL', 'OSZCZEDNOSC'], deadline: TERMIN }))).toEqual([1, 0]);
    });

    it('kazda kategoria z listy liczy sie, takze BUG (bug tez ma okres zwrotu)', () => {
      for (const kat of ['bug', 'Oszczednosc', 'PRZYCHOD', 'ryzyko', 'ANALITYKA', 'UTRZYMANIE']) {
        expect(stan(start({ tags: ['DO-STARTU', 'DZIAL', kat, 'ZWROT-3'] }))).toEqual([0, 1]);
      }
    });

    it('tag spoza listy kategorii (Wysoki) kategorii nie zastepuje', () => {
      expect(stan(start({ tags: ['DO-STARTU', 'DZIAL', 'Wysoki', 'ZWROT-6'] }))).toEqual([1, 0]);
    });

    it('kazde zadanie DO-STARTU jest albo do wyceny, albo gotowe', () => {
      const lista = [
        start({ id: 1 }),
        start({ id: 2, storyPoints: null }),
        start({ id: 3, tags: ['DO-STARTU'] }),
        start({ id: 4, tags: ['DO-STARTU', 'DZIAL', 'WYMOG'], deadline: TERMIN }),
      ];
      const w = lista.map(stan);
      expect(w.filter(([, g]) => g).length).toBe(2);
      expect(w.filter(([d]) => d).length).toBe(2);
    });
  });

  describe('rozpoznanie: gotowe do startu bez kategorii i zwrotu', () => {
    const rozp = (o: Partial<Parameters<typeof zadanie>[0]> = {}) =>
      zadanie({ id: 200, tags: ['DO-STARTU', 'DZIAL'], storyPoints: 4, ...o });
    const stan = (t: ReturnType<typeof zadanie>, recon: Set<number> | null) =>
      wg(t, recon ? { recon, value: new Set(), read: new Set([t.id]) } : null);

    it('zadanie oznaczone jako rozpoznanie jest gotowe bez kategorii i zwrotu', () => {
      expect(stan(rozp(), new Set([200]))).toEqual([0, 1]);
    });

    it('takze analiza bledu (BUG) bez tagu zwrotu, jesli oznaczona jako rozpoznanie', () => {
      expect(stan(rozp({ tags: ['DO-STARTU', 'DZIAL', 'BUG'] }), new Set([200]))).toEqual([0, 1]);
    });

    it('bez oznaczenia to zwykle niekompletne zadanie → do wyceny', () => {
      expect(stan(rozp(), new Set())).toEqual([1, 0]);
    });

    it('rozpoznanie wciaz potrzebuje wyceny', () => {
      expect(stan(rozp({ storyPoints: null }), new Set([200]))).toEqual([1, 0]);
    });

    it('do 4 h — tylko takie zadania czyta sie z czatu, powyzej to nie rozpoznanie', () => {
      expect(needsChat(rozp({ storyPoints: 4 }))).toBe(true);
      expect(needsChat(rozp({ storyPoints: 6 }))).toBe(false);
      expect(needsChat(rozp({ storyPoints: null }))).toBe(false);
    });

    it('zadanie z kompletem w tagach nie jest kandydatem — jego czatu nie czytamy', () => {
      expect(needsChat(rozp({ tags: ['DO-STARTU', 'DZIAL', 'OSZCZEDNOSC', 'ZWROT-3'] }))).toBe(false);
      expect(isCompleteByTags(rozp({ tags: ['DO-STARTU', 'DZIAL', 'OSZCZEDNOSC', 'ZWROT-3'] }))).toBe(true);
    });

    it('dopoki czaty sie czytaja (recon = null), zadanie z do 4 h nie jest jeszcze gotowe', () => {
      expect(stan(rozp(), null)).toEqual([1, 0]);
    });

    it('rozpoznaje dopisek w wiadomosci WYCENA, takze z kursywa i roznymi myslnikami', () => {
      const m = (text: string, authorId = 5): ChatMessage => ({ id: 1, authorId, text });
      const wycena = '[B]WYCENA: 4 h[/B]\n\nOpis.\n\n[I]Rozpoznanie — bez okresu zwrotu.[/I]';
      expect(hasReconMarker([m(wycena)])).toBe(true);
      expect(hasReconMarker([m('WYCENA: 4 h. Rozpoznanie - bez okresu zwrotu')])).toBe(true);
      expect(hasReconMarker([m('WYCENA: 4 h. rozpoznanie – bez okresu zwrotu')])).toBe(true);
      expect(hasReconMarker([m('WYCENA: 4 h')])).toBe(false);
      expect(hasReconMarker([m(wycena, 0)])).toBe(false);
    });

    it('rozpoznaje tez starsza postac: uzasadnienie zaczynajace sie od Rozpoznanie / Weryfikacja', () => {
      const m = (text: string): ChatMessage => ({ id: 1, authorId: 5, text });
      for (const slowo of ['Rozpoznanie', 'Weryfikacja', 'Przegląd kodu', 'Sprawdzenie']) {
        expect(hasReconMarker([m(`[B]WYCENA: 3 h[/B]\n\n[B]Co obejmuje ta wycena[/B]\n${slowo} tematu.`)])).toBe(true);
      }
      expect(hasReconMarker([m('[B]Co obejmuje ta wycena[/B]\nNowy ekran listy.')])).toBe(false);
    });

    it('do 4 h z „rozpoznanie” albo „weryfikacja” w tytule to rozpoznanie bez czytania czatu', () => {
      expect(isReconByTitle({ title: 'Rozpoznanie: sync stanów', storyPoints: 4, tags: ['DZIAL'] })).toBe(true);
      expect(isReconByTitle({ title: 'Weryfikacja błędu dostawy', storyPoints: 3, tags: ['RDZEN'] })).toBe(true);
      expect(isReconByTitle({ title: 'Weryfikacja błędu dostawy', storyPoints: 8, tags: ['DZIAL'] })).toBe(false);
      expect(isReconByTitle({ title: 'Nowy ekran', storyPoints: 2, tags: ['DZIAL'] })).toBe(false);
      expect(needsChat(rozp({ title: 'Rozpoznanie: sync stanów' }))).toBe(false);
      expect(stan(rozp({ title: 'Rozpoznanie: sync stanów' }), new Set())).toEqual([0, 1]);
    });
  });

  describe('pula: obowiazkowa, a RDZEN ma wartosc w wiadomosci WARTOSC zamiast kategorii i zwrotu', () => {
    const TERMIN = '2026-11-01T00:00:00+02:00';
    const z = (tags: string[], o: Partial<Parameters<typeof zadanie>[0]> = {}) =>
      zadanie({ id: 300, tags: ['DO-STARTU', ...tags], storyPoints: 16, ...o });
    const stan = (t: ReturnType<typeof zadanie>, value: Set<number> | null = new Set(), recon: Set<number> = new Set()) =>
      wg(t, value ? { recon, value, read: new Set([t.id]) } : null);

    it('pula to jeden z trzech tagow; przy dwoch liczy sie pierwszy z listy', () => {
      expect(pula({ tags: ['dzial'] })).toBe('DZIAL');
      expect(pula({ tags: ['Wysoki'] })).toBeNull();
      expect(pula({ tags: ['DZIAL', 'CIAGLOSC', 'RDZEN'] })).toBe('CIAGLOSC');
      expect(pula({ tags: ['DZIAL', 'RDZEN'] })).toBe('RDZEN');
    });

    it('bez puli komplet nie istnieje: kategoria + zwrot → do wyceny', () => {
      expect(stan(z(['OSZCZEDNOSC', 'ZWROT-3']))).toEqual([1, 0]);
      expect(isCompleteByTags(z(['OSZCZEDNOSC', 'ZWROT-3']))).toBe(false);
    });

    it('RDZEN + story pointy + wiadomosc WARTOSC, bez kategorii i zwrotu → gotowe', () => {
      expect(stan(z(['RDZEN']), new Set([300]))).toEqual([0, 1]);
    });

    it('RDZEN bez wiadomosci WARTOSC → do wyceny', () => {
      expect(stan(z(['RDZEN']), new Set())).toEqual([1, 0]);
      expect(isCompleteByTags(z(['RDZEN', 'OSZCZEDNOSC', 'ZWROT-3']))).toBe(false);
    });

    it('RDZEN z WARTOSC, ale bez wyceny → do wyceny', () => {
      expect(stan(z(['RDZEN'], { storyPoints: null }), new Set([300]))).toEqual([1, 0]);
    });

    it('CIAGLOSC z kategoria, ale bez ZWROT → do wyceny; ze ZWROT → gotowe', () => {
      expect(stan(z(['CIAGLOSC', 'UTRZYMANIE']))).toEqual([1, 0]);
      expect(stan(z(['CIAGLOSC', 'UTRZYMANIE', 'ZWROT-6']))).toEqual([0, 1]);
    });

    it('CIAGLOSC i DZIAL: sama wiadomosc WARTOSC kategorii nie zastepuje', () => {
      expect(stan(z(['CIAGLOSC']), new Set([300]))).toEqual([1, 0]);
      expect(stan(z(['DZIAL']), new Set([300]))).toEqual([1, 0]);
    });

    it('DZIAL z WYMOG i terminem → gotowe; bez terminu → do wyceny', () => {
      expect(stan(z(['DZIAL', 'WYMOG'], { deadline: TERMIN }))).toEqual([0, 1]);
      expect(stan(z(['DZIAL', 'WYMOG']))).toEqual([1, 0]);
    });

    it('rozpoznanie do 4 h: bez puli → do wyceny, z pula → gotowe (takze RDZEN)', () => {
      const r = (tags: string[]) => z(tags, { storyPoints: 4, title: 'Rozpoznanie: sync stanów' });
      expect(stan(r([]))).toEqual([1, 0]);
      expect(stan(r(['DZIAL']))).toEqual([0, 1]);
      expect(stan(r(['RDZEN']))).toEqual([0, 1]);
      // rozpoznane z czatu (dopisek w WYCENIE), nie z tytulu
      const bezTytulu = (tags: string[]) => z(tags, { storyPoints: 4 });
      expect(stan(bezTytulu([]), new Set(), new Set([300]))).toEqual([1, 0]);
      expect(stan(bezTytulu(['CIAGLOSC']), new Set(), new Set([300]))).toEqual([0, 1]);
    });

    it('sam STRATEGIA (bez puli) liczy sie jak RDZEN; przy prawdziwej puli nic nie zmienia', () => {
      expect(pula({ tags: ['STRATEGIA'] })).toBe('RDZEN');
      expect(stan(z(['STRATEGIA']), new Set([300]))).toEqual([0, 1]); // z wiadomoscia WARTOSC — gotowe
      expect(stan(z(['STRATEGIA']), new Set())).toEqual([1, 0]); // bez niej — do wyceny
      expect(stan(z(['DZIAL', 'STRATEGIA', 'ZWROT-3']))).toEqual([1, 0]); // STRATEGIA nie jest kategoria
      expect(stan(z(['RDZEN', 'STRATEGIA']), new Set())).toEqual([1, 0]);
    });

    it('dwie pule naraz: nie gotowe, w brakach „pule"', () => {
      const r = readiness(z(['DZIAL', 'RDZEN', 'OSZCZEDNOSC', 'ZWROT-3']), BEZ_FAKTOW);
      expect(r.ready).toBe(false);
      expect(r.missing).toContain('pule');
    });

    it('czat czytamy dla RDZEN bez kompletu (takze powyzej 4 h), nie dla zadan bez puli', () => {
      expect(needsChat(z(['RDZEN'], { storyPoints: 40 }))).toBe(true);
      expect(needsChat(z(['DZIAL'], { storyPoints: 40 }))).toBe(false);
      expect(needsChat(z(['DZIAL'], { storyPoints: 4 }))).toBe(true);
      expect(needsChat(z([], { storyPoints: 4 }))).toBe(false);
      expect(needsChat(z(['STRATEGIA'], { storyPoints: 4 }))).toBe(true); // STRATEGIA bez puli = RDZEN
    });

    it('dopoki czaty sie czytaja, RDZEN nie jest jeszcze gotowy', () => {
      expect(stan(z(['RDZEN']), null)).toEqual([1, 0]);
    });

    it('czyta wiadomosc WARTOSC: z pogrubieniem, bez polskich znakow; nie myli z wyceną; system pomija', () => {
      const m = (text: string, authorId = 5): ChatMessage => ({ id: 1, authorId, text });
      expect(hasValueMessage([m('[B]WARTOŚĆ: rdzeń[/B]\n\nUzasadnienie: cel.')])).toBe(true);
      expect(hasValueMessage([m('WARTOSC - zwrot 4 mies.')])).toBe(true);
      expect(hasValueMessage([m('WARTOŚĆ: wymóg')])).toBe(true);
      expect(hasValueMessage([m('WYCENA: 16 h'), m('Ta wartość jest niska')])).toBe(false);
      expect(hasValueMessage([m('WARTOŚĆ: rdzeń', 0)])).toBe(false);
    });
  });

  describe('okres zwrotu z tagow', () => {
    const tags = (...t: string[]) => ({ tags: t });

    it('czyta przedzial z tagu, bez wzgledu na wielkosc liter', () => {
      expect(paybackBand(tags('ZWROT-3'))).toBe('do3');
      expect(paybackBand(tags('zwrot-6'))).toBe('3-6');
      expect(paybackBand(tags('Zwrot-12'))).toBe('6-12');
      expect(paybackBand(tags('ZWROT-12+'))).toBe('ponad12');
    });

    it('brak tagu albo obcy tag → brak okresu zwrotu', () => {
      expect(paybackBand(tags('OSZCZEDNOSC', 'Wysoki'))).toBeNull();
      expect(paybackBand(tags('ZWROT-24', 'ZWROT'))).toBeNull();
      expect(paybackBand(tags())).toBeNull();
    });

    it('dwa tagi zwrotu: liczy sie najgorszy', () => {
      expect(paybackBand(tags('ZWROT-3', 'ZWROT-12'))).toBe('6-12');
    });

    it('wymog przed wszystkim, potem przedzialy, na koncu brak', () => {
      expect(paybackRank(tags('WYMOG'))).toBe(0);
      expect(paybackRank(tags('OSZCZEDNOSC', 'ZWROT-3'))).toBe(1);
      expect(paybackRank(tags('ZWROT-6'))).toBe(2);
      expect(paybackRank(tags('ZWROT-12'))).toBe(3);
      expect(paybackRank(tags('ZWROT-12+'))).toBe(4);
      expect(paybackRank(tags('OSZCZEDNOSC'))).toBe(5);
      expect(paybackRank(tags('STRATEGIA'))).toBe(5); // zwykly tag, nie ma juz wlasnej rangi
    });
  });
});

describe('foldersOf', () => {
  it('folder to rodzic z OTWARTYM podzadaniem; zamkniete dzieci go nie trzymaja', () => {
    const lista = [
      { id: 1, parentId: null, status: '2' },
      { id: 2, parentId: 1, status: '3' },
      { id: 3, parentId: null, status: '2' },
      { id: 4, parentId: 3, status: '5' },
    ];
    expect([...foldersOf(lista, new Set(['5']))]).toEqual([1]);
  });
});

describe('answerState', () => {
  const IT = new Set([900, 901]);
  const isIt = (id: number) => IT.has(id);
  const msg = (id: number, authorId: number, text = 'tekst'): ChatMessage => ({ id, authorId, text });
  const PYTANIA = '[B]1. Kto to robi?[/B]\nOpis\n\n[B]2. Jak czesto?[/B]';

  it('bez komentarza z pytaniami nie ma kotwicy', () => {
    expect(answerState([msg(1, 700), msg(2, 900, 'zwykly komentarz')], isIt)).toBe('no-question');
  });

  it('odpowiedz z numerowanymi punktami po pytaniach', () => {
    const odp = '1. Robi to magazyn\n2. Kilka razy w tygodniu';
    expect(answerState([msg(1, 900, PYTANIA), msg(2, 700, odp)], isIt)).toBe('answered');
  });

  it('dluzsza odpowiedz bez numeracji tez sie liczy', () => {
    const odp =
      'Duplikujemy zamowienia glownie przy powtorkach zakupow u stalych klientow, robimy to kilka razy dziennie i brakuje nam skopiowanych pol.';
    expect(answerState([msg(1, 900, PYTANIA), msg(2, 700, odp)], isIt)).toBe('answered');
  });

  it('ping z oznaczeniem i samo oznaczenie kogos nie sa odpowiedzia', () => {
    const czat = [
      msg(1, 800, PYTANIA),
      msg(2, 801, '[USER=101]Jan Kowalski[/USER] i [USER=102]Anna Nowak[/USER] - czy możecie odpowiedzieć na pytania?'),
      msg(3, 102, '[USER=101]Jan Kowalski[/USER]'),
    ];
    expect(answerState(czat, (id) => id === 800)).toBe('waiting');
  });

  it('po pingu prawdziwa odpowiedz nadal jest wykrywana', () => {
    const czat = [
      msg(1, 800, PYTANIA),
      msg(2, 801, '[USER=101]Jan Kowalski[/USER] czy możecie odpowiedzieć?'),
      msg(3, 101, '1. Duplikujemy raz dziennie\n2. Kopiuje sie klient i pozycje'),
    ];
    expect(answerState(czat, (id) => id === 800)).toBe('answered');
  });

  it('wpis systemowy i komentarz z IT to nie odpowiedz', () => {
    expect(answerState([msg(1, 900, PYTANIA), msg(2, 0, 'Zmiana etapu'), msg(3, 901, 'ping')], isIt)).toBe(
      'waiting',
    );
  });

  it('kolejna runda pytan przesuwa kotwice', () => {
    const czat = [msg(1, 900, PYTANIA), msg(2, 700, 'odpowiedz'), msg(3, 900, PYTANIA)];
    expect(answerState(czat, isIt)).toBe('waiting');
  });

  it('pytania zadane przez kogos spoza IT nie sa kotwica', () => {
    expect(answerState([msg(1, 700, PYTANIA), msg(2, 701, 'ok')], isIt)).toBe('no-question');
  });
});

describe('isSubstantiveAnswer', () => {
  it('wzmianki i znaczniki nie wliczaja sie do dlugosci', () => {
    expect(plainBody('[USER=101]Jan Kowalski[/USER] [B]tak[/B]')).toBe('tak');
    expect(isSubstantiveAnswer('[USER=101]Jan Kowalski[/USER]')).toBe(false);
    expect(isSubstantiveAnswer('[USER=16]a[/USER] '.repeat(20))).toBe(false);
  });

  it('numeracja wystarcza nawet w krotkiej wiadomosci, sama liczba w tekscie nie', () => {
    expect(isSubstantiveAnswer('1. tak')).toBe(true);
    expect(isSubstantiveAnswer('2) nie')).toBe(true);
    expect(isSubstantiveAnswer('mamy 3 kolektory')).toBe(false);
  });

  it('prog dlugosci to MIN_ANSWER_CHARS znakow wlasnej tresci', () => {
    expect(isSubstantiveAnswer('a'.repeat(MIN_ANSWER_CHARS - 1))).toBe(false);
    expect(isSubstantiveAnswer('a'.repeat(MIN_ANSWER_CHARS))).toBe(true);
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

describe('readiness', () => {
  const base = { id: 1, title: 'Zadanie', status: '2', sprintId: null, epicId: null, deadline: null, priority: '1' };
  const chat = (o: Partial<{ recon: number[]; value: number[] }> = {}) => ({
    recon: new Set(o.recon ?? []),
    value: new Set(o.value ?? []),
    read: new Set([1]),
  });

  it('nieprzeczytany czat: RDZEN nieznany zamiast „brak WARTOSC"; czat innego zadania nie przeszkadza', () => {
    const rdzen = { ...base, id: 7, tags: ['RDZEN'], storyPoints: 16 };
    const facts = { recon: new Set<number>(), value: new Set<number>(), read: new Set([1]) };
    expect(readiness(rdzen, facts)).toEqual({ ready: null, missing: [] });
    expect(readiness(rdzen, { ...facts, read: new Set([7]) })).toEqual({ ready: false, missing: ['wartosc'] });
    expect(readiness(rdzen, { ...facts, value: new Set([7]), read: new Set([7]) }).ready).toBe(true);
  });
  it('bez puli i bez SP: oba braki, niegotowe', () => {
    expect(readiness({ ...base, tags: ['DO-STARTU'], storyPoints: null }, chat())).toEqual({
      ready: false,
      missing: ['pula', 'sp'],
    });
  });

  it('CIAGLOSC: kategoria i zwrot; WYMOG zamiast zwrotu potrzebuje terminu', () => {
    expect(readiness({ ...base, tags: ['CIAGLOSC'], storyPoints: 8 }, chat()).missing).toEqual(['kategoria', 'zwrot']);
    const wymog = { ...base, tags: ['DZIAL', 'WYMOG', 'OSZCZEDNOSC'], storyPoints: 8 };
    expect(readiness(wymog, chat())).toEqual({ ready: false, missing: ['termin'] });
    expect(readiness({ ...wymog, deadline: '2026-11-01' }, chat())).toEqual({ ready: true, missing: [] });
  });

  it('RDZEN: gotowe dopiero z wiadomoscia WARTOSC; przed odczytem czatow — nie wiadomo', () => {
    const r = { ...base, tags: ['RDZEN'], storyPoints: 8 };
    expect(readiness(r, null).ready).toBeNull();
    expect(readiness(r, chat()).missing).toEqual(['wartosc']);
    expect(readiness(r, chat({ value: [1] })).ready).toBe(true);
  });

  it('rozpoznanie po tytule albo z czatu: sama pula i wycena', () => {
    expect(readiness({ ...base, title: 'Rozpoznanie importu', tags: ['DZIAL'], storyPoints: 3 }, chat()).ready).toBe(true);
    expect(readiness({ ...base, tags: ['DZIAL'], storyPoints: 3 }, chat({ recon: [1] })).ready).toBe(true);
    expect(readiness({ ...base, tags: ['DZIAL'], storyPoints: 3 }, null).ready).toBeNull();
  });
});
