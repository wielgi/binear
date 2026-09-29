/*
 * Liczniki nad lista — „co mam dzis do zrobienia" w rejestrze zadan.
 *
 * Kazda karta to jedno pytanie z audytu zadan: ktore DO-STARTU czekaja na wycene,
 * gdzie zglaszajacy juz odpowiedzial na pytania, co czeka na wywiad, co nie ma epika.
 * Liczby sa GLOBALNE — licza cala grupe, niezaleznie od zakresu, przelacznikow
 * („Tylko moje", „Zakonczone") i filtrow. Inaczej „ile mamy poza sprintem" zmienialoby
 * sie od tego, jak akurat patrzysz, a o to pytanie chodzi: czy jest 200, czy 220.
 *
 * Modul jest czysty (bez Reacta i bez zapytan), zeby dalo sie go przetestowac.
 */
import type { Task } from './bitrix';

export type CounterKey =
  | 'sprint'
  | 'poza'
  | 'wycena'
  | 'gotowe'
  | 'odpowiedzi'
  | 'wywiad'
  | 'epik';

export const TAG_DO_STARTU = 'DO-STARTU';
export const TAG_CZEKA = 'OCZEKUJE-NA-ODPOWIEDZ';
export const TAG_WYWIAD = 'DO-WYWIADU';

/** Bitrix nie rozroznia wielkosci liter w tagach — „do-startu" to ten sam tag. */
export const hasTag = (t: Pick<Task, 'tags'>, tag: string): boolean =>
  t.tags.some((g) => g.toUpperCase() === tag);

export interface CounterCtx {
  sprintId: number | null;
  /** Statusy uznawane za zamkniete (CLOSED_STATUSES z bitrix.ts). */
  closed: ReadonlySet<string>;
  /** Zadania OCZEKUJE-NA-ODPOWIEDZ z odpowiedzia po naszych pytaniach; `null` = jeszcze liczymy. */
  answered: ReadonlySet<number> | null;
}

type CounterTask = Pick<Task, 'id' | 'status' | 'sprintId' | 'tags' | 'storyPoints' | 'epicId'>;

export interface CounterDef {
  key: CounterKey;
  label: string;
  /** Po co ta karta — w dymku, zeby liczba nie wymagala znajomosci audytu. */
  hint: string;
  match: (t: CounterTask, ctx: CounterCtx) => boolean;
  /** Liczba zalezy od story pointow albo epika — dopoki nie doszly, jest niepewna. */
  needsMeta?: boolean;
  /** Karta istnieje tylko w projekcie ze sprintami (scrum). */
  needsSprint?: boolean;
  /** Wzrost to zla wiadomosc (wiecej roboty). Dla sprintu kierunek nic nie znaczy. */
  riseIsBad: boolean;
}

const isOpen = (t: CounterTask, ctx: CounterCtx) => !ctx.closed.has(t.status);
/**
 * Status „Odlozone" (6). Audyt odlozonych nie rusza — lezy poza kolejka, dopoki ktos
 * go swiadomie nie wznowi — wiec karty audytowe ich nie licza. „Poza sprintem" tak:
 * to dalej zadania w rejestrze.
 */
export const DEFERRED_STATUS = '6';
/** Otwarte i nieodlozone — to, czym audyt sie zajmuje. */
const inAudit = (t: CounterTask, ctx: CounterCtx) => isOpen(t, ctx) && t.status !== DEFERRED_STATUS;
const inSprint = (t: CounterTask, ctx: CounterCtx) =>
  ctx.sprintId !== null && t.sprintId === ctx.sprintId;

/*
 * Kolejnosc = kolejnosc pracy w audycie: najpierw skala rejestru, potem porzadki
 * (epik, wywiad, odpowiedzi, wycena), potem to, co juz gotowe do wziecia do sprintu,
 * na koncu sprint jako punkt odniesienia.
 */
export const COUNTERS: CounterDef[] = [
  {
    key: 'poza',
    label: 'Poza sprintem',
    hint: 'Otwarte zadania spoza aktywnego sprintu — cały rejestr, niezależnie od widoku i filtrów.',
    match: (t, ctx) => isOpen(t, ctx) && !inSprint(t, ctx),
    riseIsBad: true,
  },
  {
    key: 'epik',
    label: 'Bez epika',
    hint: 'Otwarte zadania bez epika (bez odłożonych) — nie trafiają do kolejki żadnego działu.',
    match: (t, ctx) => inAudit(t, ctx) && t.epicId == null,
    needsMeta: true,
    riseIsBad: true,
  },
  {
    key: 'wywiad',
    label: 'Do wywiadu',
    hint: 'Z tagiem DO-WYWIADU — wiadomo, o co zapytać, pytania jeszcze nie padły.',
    match: (t, ctx) => inAudit(t, ctx) && hasTag(t, TAG_WYWIAD),
    riseIsBad: true,
  },
  {
    key: 'odpowiedzi',
    label: 'Do analizy odpowiedzi',
    hint:
      'OCZEKUJE-NA-ODPOWIEDZ, a po naszych pytaniach ktoś spoza IT już napisał w czacie — ' +
      'daj DO-STARTU albo dopytaj.',
    match: (t, ctx) =>
      inAudit(t, ctx) && hasTag(t, TAG_CZEKA) && (ctx.answered?.has(t.id) ?? false),
    riseIsBad: true,
  },
  {
    key: 'wycena',
    label: 'Do wyceny',
    hint: 'Poza sprintem, z tagiem DO-STARTU, bez story pointów — uzupełnij wycenę.',
    match: (t, ctx) =>
      inAudit(t, ctx) && !inSprint(t, ctx) && hasTag(t, TAG_DO_STARTU) && t.storyPoints == null,
    needsMeta: true,
    riseIsBad: true,
  },
  {
    key: 'gotowe',
    label: 'Gotowe do startu',
    hint:
      'Poza sprintem, z tagiem DO-STARTU i z wyceną — można je wziąć do sprintu (bez odłożonych).',
    match: (t, ctx) =>
      inAudit(t, ctx) && !inSprint(t, ctx) && hasTag(t, TAG_DO_STARTU) && t.storyPoints != null,
    needsMeta: true,
    // Wiecej gotowych to dobra wiadomosc — nie kolorujemy wzrostu na bursztynowo.
    riseIsBad: false,
  },
  {
    key: 'sprint',
    label: 'W sprincie',
    hint: 'Wszystkie zadania aktywnego sprintu, także zakończone, i suma ich story pointów.',
    match: (t, ctx) => inSprint(t, ctx),
    needsSprint: true,
    riseIsBad: false,
  },
];

export const counterDef = (key: CounterKey): CounterDef =>
  COUNTERS.find((c) => c.key === key) as CounterDef;

export interface CounterValue {
  count: number;
  /** Suma story pointow — tylko dla sprintu; `null` gdy nic nie jest oszacowane. */
  points: number | null;
}

export function countAll(
  tasks: CounterTask[],
  ctx: CounterCtx,
  defs: CounterDef[] = COUNTERS,
): Record<CounterKey, CounterValue> {
  const out = {} as Record<CounterKey, CounterValue>;
  for (const d of defs) {
    let count = 0;
    let points = 0;
    let any = false;
    for (const t of tasks) {
      if (!d.match(t, ctx)) continue;
      count++;
      if (t.storyPoints != null) {
        points += t.storyPoints;
        any = true;
      }
    }
    out[d.key] = { count, points: d.key === 'sprint' && any ? points : null };
  }
  return out;
}

// ─── Odpowiedzi w czacie ─────────────────────────────────────────────────────

export interface ChatMessage {
  id: number;
  /** 0 = wpis systemowy (zmiana etapu, statusu, odpowiedzialnego). */
  authorId: number;
  /** Surowy BBCode — kotwica rozpoznawana jest po „[B]1.". */
  text: string;
}

/**
 * Pierwszy wiersz pytania w komentarzu wywiadu: „[B]1. Naglowek[/B]" — tak pisze
 * je skill wywiad-zadania. Ten sam wzorzec co w skrypcie przegladu gotowosci.
 */
export const QUESTION = /^\s*\[B\]\s*\d{1,2}\./m;

export type AnswerState = 'answered' | 'waiting' | 'no-question';

/** Ile znakow tresci (bez wzmianek i znacznikow) wystarcza za odpowiedz bez numeracji. */
export const MIN_ANSWER_CHARS = 120;

/** Tresc wiadomosci bez wzmianek „[USER=1]Imie[/USER]" i znacznikow BBCode. */
export function plainBody(text: string): string {
  return text
    .replace(/\[USER=\d+\][\s\S]*?\[\/USER\]/gi, ' ')
    .replace(/\[\/?[A-Za-z]+(?:=[^\]]*)?\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Czy wiadomosc ma tresc odpowiedzi, a nie jest samym ping-iem.
 *
 * „Jan i Anna, czy mozecie odpowiedziec?" oraz samo „Jan Kowalski" (ktos
 * oznaczony dalej) to wiadomosci osob spoza IT, ale nie odpowiadaja na zadne
 * pytanie — bez tego zadanie wygladaloby na takie, w ktorym pilka wrocila do nas.
 * Odpowiedzia jest wiadomosc z numerowanymi punktami („1.", „2)") albo majaca co
 * najmniej MIN_ANSWER_CHARS znakow wlasnej tresci. Krotkie jednozdaniowe „tak" przy
 * pojedynczym pytaniu tego progu nie przechodzi — swiadomy kompromis.
 */
export function isSubstantiveAnswer(text: string): boolean {
  const body = plainBody(text);
  if (/(?:^|\s)\d{1,2}[.)]\s*\S/.test(body)) return true;
  return body.length >= MIN_ANSWER_CHARS;
}

/**
 * Czy po NASZYCH ostatnich pytaniach ktos spoza IT faktycznie odpowiedzial.
 *
 * Kotwica = ostatnia wiadomosc osoby z IT w formacie pytan wywiadu. Kolejna runda
 * pytan przesuwa kotwice, wiec stare odpowiedzi nie udaja nowych. Odpowiedzia jest
 * pozniejsza wiadomosc osoby spoza IT, ktora ma tresc (patrz `isSubstantiveAnswer`).
 * Wpisy systemowe i same ping-i odpadaja.
 *
 * `messages` od najstarszej do najnowszej.
 */
export function answerState(messages: ChatMessage[], isIt: (authorId: number) => boolean): AnswerState {
  let anchor = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.authorId > 0 && isIt(m.authorId) && QUESTION.test(m.text)) {
      anchor = i;
      break;
    }
  }
  if (anchor < 0) return 'no-question';
  for (let i = anchor + 1; i < messages.length; i++) {
    const m = messages[i];
    if (m.authorId > 0 && !isIt(m.authorId) && isSubstantiveAnswer(m.text)) return 'answered';
  }
  return 'waiting';
}

// ─── Historia dzien po dniu ──────────────────────────────────────────────────

/** Stan licznikow jednego dnia. Klucz `sprintPoints` = suma SP sprintu. */
export type DaySnapshot = Partial<Record<CounterKey | 'sprintPoints', number>>;
/** Dzien (RRRR-MM-DD, czas lokalny) → stan. */
export type CounterHistory = Record<string, DaySnapshot>;

export const HISTORY_DAYS = 90;

export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Zapisuje dzisiejszy stan — ostatni odczyt dnia nadpisuje wczesniejsze, wiec
 * wpis dnia to stan „na koniec dnia" (albo na teraz, jesli dzien trwa). Klucze
 * z `snap` sa scalane, a nie podmieniane: karta, ktorej wartosc jeszcze sie liczy,
 * nie kasuje tego, co juz dzis zapisano.
 */
export function recordDay(
  history: CounterHistory,
  day: string,
  snap: DaySnapshot,
  keep = HISTORY_DAYS,
): CounterHistory {
  const next: CounterHistory = { ...history, [day]: { ...history[day], ...snap } };
  const days = Object.keys(next).sort();
  for (const old of days.slice(0, Math.max(0, days.length - keep))) delete next[old];
  return next;
}

/** Ostatni zapisany dzien PRZED `day` — punkt odniesienia dla strzalki. */
export function previousDay(
  history: CounterHistory,
  day: string,
): { day: string; snap: DaySnapshot } | null {
  const earlier = Object.keys(history).filter((d) => d < day).sort();
  const last = earlier.at(-1);
  return last ? { day: last, snap: history[last] } : null;
}

const STORAGE_KEY = 'binear.counters.v1';

export function loadHistory(groupId: number): CounterHistory {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    const h = all?.[groupId];
    return h && typeof h === 'object' ? h : {};
  } catch {
    return {};
  }
}

export function saveHistory(groupId: number, history: CounterHistory): void {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') ?? {};
    all[groupId] = history;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* Brak miejsca albo zablokowany storage — licznik dziala dalej, bez strzalek. */
  }
}
