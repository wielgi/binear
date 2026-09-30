import { describe, expect, it } from 'vitest';
import type { Task } from './bitrix';
import { paybackRank } from './counters';
import { planComparator, stackComparator, type Cmp } from './planSort';

/** Zadanie z samymi polami, ktore czyta sortowanie planowania. */
const task = (id: number, p: Partial<Task> = {}): Task =>
  ({ id, priority: '1', tags: [], storyPoints: null, responsibleId: null, stageId: null, ...p }) as Task;

/* Os priorytetu jak w liscie: 2 (wysoki) przed 1 przed 0. */
const RANK: Record<string, number> = { '2': 0, '1': 1, '0': 2 };
const deps = {
  axis: (by: string, a: Task, b: Task) => (by === 'priority' ? RANK[a.priority] - RANK[b.priority] : 0),
  stageRank: (t: Task) => t.stageId ?? Number.MAX_SAFE_INTEGER,
  me: null as number | null,
};

const ids = (tasks: Task[], sort: Parameters<typeof planComparator>[0], d = deps) =>
  [...tasks].sort(planComparator(sort, d)).map((t) => t.id);

describe('stackComparator', () => {
  it('siega do kolejnego poziomu tylko przy remisie', () => {
    const calls: string[] = [];
    const first: Cmp = () => (calls.push('1'), 0);
    const second: Cmp = () => (calls.push('2'), -1);
    expect(stackComparator([first, second], () => 99)(task(1), task(2))).toBe(-1);
    expect(calls).toEqual(['1', '2']);
  });

  it('ogon rozstrzyga dopiero remis po CALYM stosie', () => {
    const tie: Cmp = () => 0;
    expect(stackComparator([tie, tie], () => 7)(task(1), task(2))).toBe(7);
  });

  it('pierwszy rozstrzygajacy poziom konczy porownanie', () => {
    const later: Cmp = () => {
      throw new Error('nie powinien byc wolany');
    };
    expect(stackComparator([() => 1, later], () => 0)(task(1), task(2))).toBe(1);
  });
});

describe('planComparator', () => {
  /*
   * Blad, ktory to naprawia: pierwszy poziom nigdy nie oddawal remisu, wiec
   * przy tym samym priorytecie SP nic nie znaczyly.
   */
  it('przy tym samym priorytecie sortuje po SP (drugi poziom dziala)', () => {
    const tasks = [
      task(1, { priority: '1', storyPoints: 2 }),
      task(2, { priority: '1', storyPoints: 8 }),
      task(3, { priority: '2', storyPoints: 1 }),
      task(4, { priority: '1', storyPoints: 5 }),
    ];
    expect(
      ids(tasks, [
        { by: 'priority', dir: 'asc' },
        { by: 'sp', dir: 'desc' },
      ]),
    ).toEqual([3, 2, 4, 1]);
  });

  it('domyslna kolejnosc waznosci: priorytet, potem tag Wysoki, potem SP malejaco', () => {
    /* Kolejnosc po id (ogon) jest inna niz oczekiwana — test nie zda przypadkiem. */
    const tasks = [
      task(1, { priority: '1', tags: ['wysoki'], storyPoints: 5 }),
      task(2, { priority: '1', tags: ['Wysoki'], storyPoints: 1 }),
      task(3, { priority: '1', storyPoints: 8 }),
      task(4, { priority: '2', storyPoints: 1 }),
    ];
    expect(
      ids(tasks, [
        { by: 'priority', dir: 'asc' },
        { by: 'wysoki', dir: 'asc' },
        { by: 'sp', dir: 'desc' },
      ]),
    ).toEqual([4, 1, 2, 3]);
  });

  it('kierunek odwraca tylko swoj poziom', () => {
    const tasks = [
      task(1, { priority: '1', storyPoints: 2 }),
      task(2, { priority: '2', storyPoints: 2 }),
      task(3, { priority: '1', storyPoints: 9 }),
    ];
    expect(
      ids(tasks, [
        { by: 'priority', dir: 'desc' },
        { by: 'sp', dir: 'desc' },
      ]),
    ).toEqual([3, 1, 2]);
  });

  it('bez SP liczy sie jako 0', () => {
    const tasks = [task(1, { storyPoints: null }), task(2, { storyPoints: 3 })];
    expect(ids(tasks, [{ by: 'sp', dir: 'desc' }])).toEqual([2, 1]);
  });

  it('zadanie bez etapu idzie na koniec', () => {
    const tasks = [task(1), task(2, { stageId: 3 }), task(3, { stageId: 1 })];
    expect(ids(tasks, [{ by: 'stage', dir: 'asc' }])).toEqual([3, 2, 1]);
  });

  it('pelny remis: moje wyzej, potem id malejaco', () => {
    const tasks = [task(1), task(2, { responsibleId: 7 }), task(3)];
    expect(ids(tasks, [{ by: 'sp', dir: 'desc' }], { ...deps, me: 7 })).toEqual([2, 3, 1]);
  });
});

describe('sortowanie po zwrocie', () => {
  const d = { ...deps, paybackRank };
  const zwrot = [{ by: 'zwrot', dir: 'asc' as const }];

  it('od najkrotszego zwrotu do najdluzszego, na koncu zadania bez okresu zwrotu', () => {
    const tasks = [
      task(3, { tags: ['ZWROT-12+'] }),
      task(1, { tags: ['ZWROT-12'] }),
      task(5),
      task(2, { tags: ['ZWROT-3'] }),
      task(4, { tags: ['ZWROT-6'] }),
    ];
    expect(ids(tasks, zwrot, d)).toEqual([2, 4, 1, 3, 5]);
  });

  it('wymogi na poczatku, od najblizszego terminu; wymog bez terminu za tymi z terminem', () => {
    const tasks = [
      task(2, { tags: ['ZWROT-3'] }),
      task(10, { tags: ['WYMOG'], deadline: '2026-11-20T00:00:00+02:00' }),
      task(11, { tags: ['wymog'], deadline: '2026-10-05T00:00:00+02:00' }),
      task(12, { tags: ['WYMOG'], deadline: null }),
    ];
    expect(ids(tasks, zwrot, d)).toEqual([11, 10, 12, 2]);
  });

  it('strategia osobnym blokiem tuz po wymogach, przed przedzialami', () => {
    const tasks = [
      task(2, { tags: ['ZWROT-3'] }),
      task(20, { tags: ['STRATEGIA'] }),
      task(10, { tags: ['WYMOG'], deadline: '2026-11-20T00:00:00+02:00' }),
      task(3, { tags: ['ZWROT-12+'] }),
      task(5),
    ];
    expect(ids(tasks, zwrot, d)).toEqual([10, 20, 2, 3, 5]);
  });

  it('w tym samym przedziale rozstrzyga kolejny poziom stosu', () => {
    const tasks = [task(2, { tags: ['ZWROT-3'], storyPoints: 2 }), task(7, { tags: ['ZWROT-3'], storyPoints: 9 })];
    expect(
      ids(tasks, [{ by: 'zwrot', dir: 'asc' }, { by: 'sp', dir: 'desc' }], d),
    ).toEqual([7, 2]);
  });

  it('odwrocony kierunek daje najgorszy zwrot na gorze', () => {
    const tasks = [task(2, { tags: ['ZWROT-3'] }), task(3, { tags: ['ZWROT-12+'] }), task(5)];
    expect(ids(tasks, [{ by: 'zwrot', dir: 'desc' }], d)).toEqual([5, 3, 2]);
  });
});
