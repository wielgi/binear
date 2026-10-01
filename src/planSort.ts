/*
 * Kolejnosc zadan w widoku planowania — STOS kluczy: pierwszy rozstrzyga,
 * kolejny wchodzi dopiero przy remisie, a remis po calym stosie rozstrzyga ogon
 * (moje wyzej, potem po id).
 *
 * Osobno od App.tsx, zeby dalo sie to przetestowac: blad, ktory tu siedzial,
 * byl niewidoczny w kodzie, a widoczny dopiero w kolejnosci wierszy.
 */
import type { Task } from './bitrix';
import { hasTag, TAG_STRATEGIA } from './counters';

export type Cmp = (a: Task, b: Task) => number;

export interface PlanSortLevel {
  by: string;
  dir: 'asc' | 'desc';
}

/**
 * Sklada stos poziomow w jeden komparator.
 *
 * Kazdy poziom musi umiec ODDAC REMIS (zwrocic 0). Wczesniej poziomy skladano
 * z komparatora listy, ktory sam dokladal ogon i nigdy nie zwracal zera — wtedy
 * „priorytet, potem tag Wysoki, potem SP" konczylo sie na priorytecie. Dlatego
 * ogon dochodzi tu RAZ, po calym stosie.
 */
export function stackComparator(levels: Cmp[], tail: Cmp): Cmp {
  return (a, b) => {
    for (const cmp of levels) {
      const r = cmp(a, b);
      if (r !== 0) return r;
    }
    return tail(a, b);
  };
}

/** Termin zadania jako czas; brak terminu idzie na koniec (najdalej). */
const deadlineTime = (t: Task): number => {
  const ms = t.deadline ? Date.parse(t.deadline) : NaN;
  return Number.isNaN(ms) ? Number.MAX_SAFE_INTEGER : ms;
};

/** Ma tag STRATEGIA — ranga 0, inaczej 1. Strategia idzie na sam poczatek, przed wszystkim innym. */
const strategiaRank = (t: Task) => (hasTag(t, TAG_STRATEGIA) ? 0 : 1);

/** Ma tag „Wysoki" (bez wzgledu na wielkosc liter) — ranga 0, inaczej 1. */
const wysokiRank = (t: Task) => (t.tags.some((g) => g.toLowerCase() === 'wysoki') ? 0 : 1);

/**
 * Domyslna kolejnosc waznosci:
 *   1. priorytet Bitriksa — plomien to awaria, firma nie moze pracowac, wiec nic go nie wyprzedza,
 *   2. STRATEGIA (o jej kolejnosci decyduje rada, wiec nie miesza sie z reszta),
 *   3. okres zwrotu rosnaco (ZWROT-3 przed ZWROT-6 itd.; wymogi po terminie, zadania bez zwrotu
 *      na koncu) — to on ustawia kolejke,
 *   4. tag „Wysoki" — dopiero rozstrzyga remis w obrebie tego samego zwrotu, a nie przeskakuje
 *      zadania o lepszym zwrocie,
 *   5. story pointy malejaco.
 */
export const PLAN_SORT_DOMYSLNY: PlanSortLevel[] = [
  { by: 'priority', dir: 'asc' },
  { by: 'strategia', dir: 'asc' },
  { by: 'zwrot', dir: 'asc' },
  { by: 'wysoki', dir: 'asc' },
  { by: 'sp', dir: 'desc' },
];

/** Dawne domyslne stosy — kto ich nie ruszal, dostaje nowy domyslny, a nie zamrozony stary. */
const STARE_DOMYSLNE: PlanSortLevel[][] = [
  [
    { by: 'priority', dir: 'asc' },
    { by: 'wysoki', dir: 'asc' },
    { by: 'sp', dir: 'desc' },
  ],
  [
    { by: 'priority', dir: 'asc' },
    { by: 'wysoki', dir: 'asc' },
    { by: 'zwrot', dir: 'asc' },
    { by: 'sp', dir: 'desc' },
  ],
  [
    { by: 'strategia', dir: 'asc' },
    { by: 'priority', dir: 'asc' },
    { by: 'wysoki', dir: 'asc' },
    { by: 'zwrot', dir: 'asc' },
    { by: 'sp', dir: 'desc' },
  ],
];

const takSamo = (a: PlanSortLevel[], b: PlanSortLevel[]) =>
  a.length === b.length && a.every((l, i) => l.by === b[i].by && l.dir === b[i].dir);

/**
 * Zapisane w przegladarce sortowanie planowania. Zapisany jest CALY stos, wiec kto nigdy go nie
 * zmienil, mial w localStorage stary domyslny — i nowa kolejnosc nigdy by do niego nie dotarla. Stary domyslny zastepujemy nowym; stos ulozony przez uzytkownika zostaje jak byl.
 */
export function migratePlanSort(saved: PlanSortLevel[] | undefined): PlanSortLevel[] | undefined {
  if (!saved) return undefined;
  return STARE_DOMYSLNE.some((s) => takSamo(saved, s)) ? PLAN_SORT_DOMYSLNY : saved;
}

/**
 * Komparator planowania dla wybranego stosu.
 *
 * `axis` to rosnace porownanie osi wspolnych z lista (priorytet, daty, tytul) —
 * podawane z zewnatrz, zeby „po priorytecie" znaczylo tu to samo co na liscie.
 * `stageRank` to pozycja etapu w procesie; zadanie bez etapu idzie na koniec.
 * `paybackRank` to miejsce w sortowaniu „po zwrocie" (patrz `paybackRank` w counters.ts);
 * bez niej ta os niczego nie rozstrzyga.
 */
export function planComparator(
  sort: PlanSortLevel[],
  deps: {
    axis: (by: string, a: Task, b: Task) => number;
    stageRank: (t: Task) => number;
    me: number | null;
    paybackRank?: (t: Task) => number;
  },
): Cmp {
  /*
   * „Po zwrocie": wymogi na poczatku, od najblizszego terminu (wymog ma date, nie
   * ranking), potem przedzialy od najlepszego, na koncu zadania bez okresu zwrotu.
   * Zadania w tym samym przedziale zostaja w remisie — rozstrzyga kolejny poziom stosu.
   */
  const rankOf = deps.paybackRank ?? (() => 0);
  const byPayback: Cmp = (a, b) => {
    const r = rankOf(a) - rankOf(b);
    if (r !== 0 || rankOf(a) !== 0) return r;
    return deadlineTime(a) - deadlineTime(b);
  };

  const levels = sort.map((lvl): Cmp => {
    /* Kazda os ROSNACO — kierunek doklada dopiero `odwroc`. */
    const f: Cmp =
      lvl.by === 'stage'
        ? (a, b) => deps.stageRank(a) - deps.stageRank(b)
        : lvl.by === 'strategia'
          ? (a, b) => strategiaRank(a) - strategiaRank(b)
          : lvl.by === 'wysoki'
          ? (a, b) => wysokiRank(a) - wysokiRank(b)
          : lvl.by === 'sp'
            ? (a, b) => (a.storyPoints ?? 0) - (b.storyPoints ?? 0)
            : lvl.by === 'zwrot'
              ? byPayback
              : (a, b) => deps.axis(lvl.by, a, b);
    return lvl.dir === 'asc' ? f : (a, b) => -f(a, b);
  });

  /* Remis po CALYM stosie, tak samo jak w liscie: moje wyzej, potem po id malejaco. */
  const mineRank = (t: Task) => (deps.me !== null && t.responsibleId === deps.me ? 0 : 1);
  return stackComparator(levels, (a, b) => mineRank(a) - mineRank(b) || b.id - a.id);
}
