/*
 * Pasek licznikow pod naglowkiem — karty z liczba i etykieta, klikniecie filtruje liste.
 * Definicje i logika w `counters.ts`; tu tylko React: pobranie czatow do karty
 * odpowiedzi, dzienna historia (strzalki „od wczoraj") i sam widok.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { fetchChatTail, type ChatTail, type Task } from './bitrix';
import {
  answerState,
  dayKey,
  DEFERRED_STATUS,
  hasTag,
  loadHistory,
  previousDay,
  recordDay,
  saveHistory,
  TAG_CZEKA,
  type CounterDef,
  type CounterKey,
  type CounterValue,
  type DaySnapshot,
} from './counters';
import { CalendarIcon, CommentIcon, HashIcon, LayersIcon, ListIcon, PenIcon } from './icons';

/** Czaty dociagamy ponownie co tyle, nawet gdy lista sie nie zmienila. */
const ANSWERS_REFRESH_MS = 5 * 60_000;

/**
 * Zadania OCZEKUJE-NA-ODPOWIEDZ, w ktorych po naszych pytaniach odezwal sie ktos spoza IT.
 *
 * Ta sama regula co w przegladzie gotowosci z audytu: kotwica to ostatni komentarz
 * z pytaniami („[B]1.") napisany przez IT, odpowiedz to pozniejsza wiadomosc osoby
 * spoza IT. IT = konto webhooka, konta z BX_IT_USERS (np. automat wywiadow, ktory
 * siedzi w dziale spoza IT) i ludzie z dzialow BX_IT_DEPARTMENTS. Podzadanie bez
 * wlasnych pytan czyta czat rodzica — tag siedzi na podzadaniach, a pytania czesto
 * padly w zadaniu nadrzednym.
 *
 * `null` dopoki pierwszy przebieg dla tego projektu sie nie skonczy. Kolejne
 * przebiegi zostawiaja poprzedni wynik na ekranie, zeby karta nie migala.
 */
export function useAnsweredTasks(
  tasks: Task[],
  opts: {
    closed: ReadonlySet<string>;
    itDepartments: number[];
    itUsers: number[];
    me: number | null;
    groupId: number | null;
    enabled: boolean;
  },
): ReadonlySet<number> | null {
  const { closed, itDepartments, itUsers, me, groupId, enabled } = opts;
  const [state, setState] = useState<{ group: number | null; answered: Set<number> } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), ANSWERS_REFRESH_MS);
    return () => clearInterval(t);
  }, []);

  const candidates = useMemo(
    // Odlozonych karta i tak nie liczy — nie czytamy ich czatow na darmo.
    () =>
      tasks.filter(
        (t) => !closed.has(t.status) && t.status !== DEFERRED_STATUS && hasTag(t, TAG_CZEKA),
      ),
    [tasks, closed],
  );

  /*
   * Klucz przebiegu: nowa wiadomosc w czacie podbija licznik nieprzeczytanych albo
   * date zmiany, wiec przeliczamy, gdy ktores z nich drgnie — a poza tym co 5 minut.
   */
  const key = useMemo(
    () =>
      `${groupId}#${tick}#${itDepartments.join(',')}#${itUsers.join(',')}#` +
      candidates.map((t) => `${t.id}:${t.chatId}:${t.changedDate}:${t.newComments}`).join('|'),
    [candidates, groupId, tick, itDepartments, itUsers],
  );

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const itDeps = new Set(itDepartments);
    const itIds = new Set(itUsers);

    (async () => {
      const tails = new Map<number, ChatTail>();
      const departments = new Map<number, number[]>();
      const load = async (chatIds: number[]) => {
        const fresh = [...new Set(chatIds)].filter((id) => !tails.has(id));
        const got = await Promise.allSettled(fresh.map((id) => fetchChatTail(id)));
        got.forEach((r, i) => {
          if (r.status !== 'fulfilled') return;
          tails.set(fresh[i], r.value);
          // Dzialy wszystkich autorow znane, zanim cokolwiek ocenimy.
          r.value.departments.forEach((v, k) => departments.set(k, v));
        });
      };
      const isIt = (id: number) =>
        id === me || itIds.has(id) || (departments.get(id) ?? []).some((d) => itDeps.has(d));
      const stateOf = (chatId: number | null) => {
        const tail = chatId ? tails.get(chatId) : undefined;
        return tail ? answerState(tail.messages, isIt) : ('no-question' as const);
      };

      await load(candidates.map((t) => t.chatId).filter((c): c is number => c !== null));

      const answered = new Set<number>();
      const viaParent: Task[] = [];
      for (const t of candidates) {
        const s = stateOf(t.chatId);
        if (s === 'answered') answered.add(t.id);
        else if (s === 'no-question' && t.parentId) viaParent.push(t);
      }

      const parentChat = (t: Task) => byId.get(t.parentId as number)?.chatId ?? null;
      await load(viaParent.map(parentChat).filter((c): c is number => c !== null));
      for (const t of viaParent) if (stateOf(parentChat(t)) === 'answered') answered.add(t.id);

      if (!cancelled) setState({ group: groupId, answered });
    })().catch(() => {
      /* Czat nieczytelny (brak zakresu `im`) — karta zostaje przy ostatnim wyniku. */
    });

    return () => {
      cancelled = true;
    };
    // `tasks` i reszta sa w kluczu — efekt ma ruszac tylko, gdy klucz sie zmieni.
  }, [key, enabled]);

  return state && state.group === groupId ? state.answered : null;
}

/**
 * Dzienna historia licznikow w przegladarce (binear.counters.v1, osobno per projekt)
 * i punkt odniesienia dla strzalek — ostatni zapisany dzien przed dzisiejszym.
 *
 * `snap` zawiera tylko wartosci PEWNE: karta, ktora jeszcze liczy (story pointy
 * w drodze, czaty w drodze), nie trafia do zapisu, zeby „zero w trakcie ladowania"
 * nie udawalo spadku.
 */
export function useCounterHistory(groupId: number | null, snap: DaySnapshot) {
  const today = dayKey(new Date());
  const [history, setHistory] = useState(() => (groupId ? loadHistory(groupId) : {}));
  const sig = JSON.stringify(snap);

  useEffect(() => {
    setHistory(groupId ? loadHistory(groupId) : {});
  }, [groupId]);

  useEffect(() => {
    if (!groupId || sig === '{}') return;
    setHistory((h) => {
      const next = recordDay(h, today, snap);
      saveHistory(groupId, next);
      return next;
    });
    // `snap` porownujemy po `sig` — nowy obiekt przy kazdym renderze nie jest zmiana.
  }, [groupId, sig, today]);

  return useMemo(() => previousDay(history, today), [history, today]);
}

/** Ikona karty; kolor siedzi w CSS (`.counter-<klucz>`), zeby motywy mogly go nadpisac. */
const ICONS: Record<CounterKey, ReactNode> = {
  poza: <ListIcon />,
  epik: <LayersIcon />,
  wywiad: <PenIcon />,
  odpowiedzi: <CommentIcon />,
  wycena: <HashIcon />,
  sprint: <CalendarIcon />,
};

function dayLabel(day: string, today: Date): string {
  const y = new Date(today);
  y.setDate(y.getDate() - 1);
  if (day === dayKey(y)) return 'wczoraj';
  const [, m, d] = day.split('-');
  return `${d}.${m}`;
}

function Delta({
  now,
  before,
  day,
  riseIsBad,
}: {
  now: number;
  before: number | undefined;
  day: string;
  riseIsBad: boolean;
}) {
  if (before === undefined) return <span className="counter-delta">—</span>;
  const diff = now - before;
  const when = dayLabel(day, new Date());
  const tone = diff === 0 || !riseIsBad ? '' : diff > 0 ? ' counter-delta-up' : ' counter-delta-down';
  return (
    <span className={`counter-delta${tone}`} title={`${when}: ${before}`}>
      {diff === 0 ? '=' : diff > 0 ? `▲ ${diff}` : `▼ ${-diff}`}{' '}
      <span className="counter-delta-when">{when}</span>
    </span>
  );
}

export function CountersBar({
  defs,
  values,
  pending,
  prev,
  active,
  onPick,
}: {
  defs: CounterDef[];
  values: Record<CounterKey, CounterValue>;
  /** Karty, ktorych liczba jest jeszcze niepewna — pokazujemy wielokropek. */
  pending: ReadonlySet<CounterKey>;
  prev: { day: string; snap: DaySnapshot } | null;
  active: CounterKey | null;
  onPick: (key: CounterKey | null) => void;
}) {
  return (
    <div className="counters" role="toolbar" aria-label="Liczniki zadań">
      {defs.map((d) => {
        const v = values[d.key];
        const isPending = pending.has(d.key);
        const on = active === d.key;
        return (
          <button
            key={d.key}
            className={`counter counter-${d.key}${on ? ' counter-on' : ''}`}
            aria-pressed={on}
            title={on ? `${d.hint}\n\nKliknij ponownie, żeby wrócić do zwykłego widoku.` : d.hint}
            onClick={() => onPick(on ? null : d.key)}
          >
            <span className="counter-icon">{ICONS[d.key]}</span>
            <span className="counter-body">
              <span className="counter-top">
                <span className={`counter-value${isPending ? ' counter-pending' : ''}`}>
                  {isPending ? '…' : v.count}
                </span>
                {d.key === 'sprint' && v.points !== null && !isPending && (
                  <span className="counter-points">{v.points} SP</span>
                )}
              </span>
              <span className="counter-label">{d.label}</span>
              {!isPending && prev && (
                <Delta now={v.count} before={prev.snap[d.key]} day={prev.day} riseIsBad={d.riseIsBad} />
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
