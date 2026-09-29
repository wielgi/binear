/*
 * Kolejnosc zadan w widoku planowania — STOS kluczy: pierwszy rozstrzyga,
 * kolejny wchodzi dopiero przy remisie, a remis po calym stosie rozstrzyga ogon
 * (moje wyzej, potem po id).
 *
 * Osobno od App.tsx, zeby dalo sie to przetestowac: blad, ktory tu siedzial,
 * byl niewidoczny w kodzie, a widoczny dopiero w kolejnosci wierszy.
 */
import type { Task } from './bitrix';

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

/** Ma tag „Wysoki" (bez wzgledu na wielkosc liter) — ranga 0, inaczej 1. */
const wysokiRank = (t: Task) => (t.tags.some((g) => g.toLowerCase() === 'wysoki') ? 0 : 1);

/**
 * Komparator planowania dla wybranego stosu.
 *
 * `axis` to rosnace porownanie osi wspolnych z lista (priorytet, daty, tytul) —
 * podawane z zewnatrz, zeby „po priorytecie" znaczylo tu to samo co na liscie.
 * `stageRank` to pozycja etapu w procesie; zadanie bez etapu idzie na koniec.
 */
export function planComparator(
  sort: PlanSortLevel[],
  deps: { axis: (by: string, a: Task, b: Task) => number; stageRank: (t: Task) => number; me: number | null },
): Cmp {
  const levels = sort.map((lvl): Cmp => {
    /* Kazda os ROSNACO — kierunek doklada dopiero `odwroc`. */
    const f: Cmp =
      lvl.by === 'stage'
        ? (a, b) => deps.stageRank(a) - deps.stageRank(b)
        : lvl.by === 'wysoki'
          ? (a, b) => wysokiRank(a) - wysokiRank(b)
          : lvl.by === 'sp'
            ? (a, b) => (a.storyPoints ?? 0) - (b.storyPoints ?? 0)
            : (a, b) => deps.axis(lvl.by, a, b);
    return lvl.dir === 'asc' ? f : (a, b) => -f(a, b);
  });

  /* Remis po CALYM stosie, tak samo jak w liscie: moje wyzej, potem po id malejaco. */
  const mineRank = (t: Task) => (deps.me !== null && t.responsibleId === deps.me ? 0 : 1);
  return stackComparator(levels, (a, b) => mineRank(a) - mineRank(b) || b.id - a.id);
}
