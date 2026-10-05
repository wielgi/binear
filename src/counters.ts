/*
 * Liczniki nad lista — „co mam dzis do zrobienia" w rejestrze zadan.
 *
 * Liczby sa GLOBALNE — licza cala grupe, niezaleznie od zakresu, przelacznikow
 * („Tylko moje", „Zakonczone") i filtrow. Inaczej „ile mamy poza sprintem" zmienialoby
 * sie od tego, jak akurat patrzysz, a o to pytanie chodzi: czy jest 200, czy 220.
 *
 * ROZBICIE „POZA SPRINTEM"
 * Otwarte zadania spoza aktywnego sprintu, BEZ odlozonych, dziela sie na stany, ktore
 * sie wykluczaja i razem daja dokladnie „Poza sprintem":
 *
 *   DO-STARTU, z wyceną, kategorią
 *     i okresem zwrotu              → Gotowe do startu
 *   DO-STARTU, bez któregokolwiek
 *     z tych trzech                 → Do wyceny
 *   OCZEKUJE-NA-ODPOWIEDZ + wpis    → Do analizy odpowiedzi
 *   OCZEKUJE-NA-ODPOWIEDZ           → Czeka na odpowiedz
 *   cala reszta                     → Do wywiadu (DO-WYWIADU albo brak tagu gotowosci)
 *
 * „Do wywiadu" jest dopelnieniem, wiec suma zgadza sie z definicji — takze gdy zadanie
 * ma dwa tagi gotowosci (pierwszenstwo: DO-STARTU, potem OCZEKUJE) albo tag spoza
 * listy (BUG, Wysoki). Zadanie nowe, bez zadnego tagu gotowosci, to zadanie, o ktore
 * trzeba dopiero zapytac.
 *
 * Odlozone (status 6) leza poza kolejka audytu i poza suma; pokazuje je osobna,
 * wyszarzona notka pod kafelkami.
 *
 * BUG to CECHA, nie stan: zadanie z tagiem BUG jest jednoczesnie w jednym ze stanow,
 * wiec jego kafelek stoi za pionowym separatorem, poza rozbiciem, i nie dodaje sie do sumy.
 *
 * Modul jest czysty (bez Reacta i bez zapytan), zeby dalo sie go przetestowac.
 */
import type { Task } from './bitrix';

export type CounterKey =
  | 'poza'
  | 'wywiad'
  | 'czeka'
  | 'odpowiedzi'
  | 'wycena'
  | 'gotowe'
  | 'sprint'
  | 'bug'
  | 'koncept'
  | 'odlozone';

export const TAG_DO_STARTU = 'DO-STARTU';
export const TAG_CZEKA = 'OCZEKUJE-NA-ODPOWIEDZ';
export const TAG_WYWIAD = 'DO-WYWIADU';
export const TAG_BUG = 'BUG';
/**
 * Pomysl, a nie zadanie do zrobienia. Nowy tag to KONCEPT; starsze zadania
 * maja KONCEPCJA — liczymy oba, zeby kafelek nie zgubil tych sprzed zmiany.
 */
export const TAGS_KONCEPT = ['KONCEPT', 'KONCEPCJA'];

/*
 * Kategoria korzyści zadania — jeden tag na zadanie. `BUG` jest kategorią „naprawa błędu"
 * i już istnieje jako tag; pozostałe to nowe tagi z zasad wartości zadań.
 */
export const TAG_WYMOG = 'WYMOG';
/**
 * Zadanie strategiczne, którego korzyści nie da się przeliczyć na czas ani pieniądze. Nie ma okresu
 * zwrotu ani tagu ZWROT — zamiast tego ma jedno zdanie uzasadnienia w wiadomości WARTOŚĆ. Nadaje je
 * wyłącznie kierownik IT albo zarząd; o kolejności decyduje rada.
 */
export const TAG_STRATEGIA = 'STRATEGIA';
export const TAGS_KATEGORIA = [
  TAG_BUG,
  'OSZCZEDNOSC',
  'PRZYCHOD',
  'RYZYKO',
  'ANALITYKA',
  'UTRZYMANIE',
  TAG_WYMOG,
  TAG_STRATEGIA,
];

/** Bitrix nie rozroznia wielkosci liter w tagach — „do-startu" to ten sam tag. */
export const hasTag = (t: Pick<Task, 'tags'>, tag: string): boolean =>
  t.tags.some((g) => g.toUpperCase() === tag);

export interface CounterCtx {
  sprintId: number | null;
  /** Statusy uznawane za zamkniete (CLOSED_STATUSES z bitrix.ts). */
  closed: ReadonlySet<string>;
  /** Zadania OCZEKUJE-NA-ODPOWIEDZ z odpowiedzia po naszych pytaniach; `null` = jeszcze liczymy. */
  answered: ReadonlySet<number> | null;
  /**
   * Fakty, które widać tylko w czacie zadania; `null` = jeszcze czytamy czaty. Czytamy je wyłącznie
   * dla zadań, którym do kompletu brakuje czegoś, co może tam być (patrz `needsChat`).
   */
  chat: ChatFacts | null;
}

/**
 * Co wiemy z czatów zadań DO-STARTU:
 *  - `recon` — oznaczone jako rozpoznanie albo analiza błędu (dopisek w wiadomości WYCENA); takie
 *    zadanie jest gotowe bez kategorii i bez okresu zwrotu, bo wartość liczymy dopiero przy właściwym
 *    zadaniu, które z niego powstanie,
 *  - `strategic` — zadania STRATEGIA, które mają już wiadomość WARTOŚĆ z uzasadnieniem.
 */
export interface ChatFacts {
  recon: ReadonlySet<number>;
  strategic: ReadonlySet<number>;
}

type CounterTask = Pick<
  Task,
  'id' | 'title' | 'status' | 'sprintId' | 'tags' | 'storyPoints' | 'epicId' | 'deadline'
>;

export interface CounterDef {
  key: CounterKey;
  label: string;
  /** Po co ta karta — w dymku, zeby liczba nie wymagala znajomosci audytu. */
  hint: string;
  match: (t: CounterTask, ctx: CounterCtx) => boolean;
  /** Liczba zalezy od story pointow — dopoki nie doszly, jest niepewna. */
  needsMeta?: boolean;
  /** Liczba zalezy tez od rozpoznan (dopisek w wiadomosci WYCENA w czacie) — niepewna, dopoki czaty sie czytaja. */
  needsChatFacts?: boolean;
  /** Karta istnieje tylko w projekcie ze sprintami (scrum). */
  needsSprint?: boolean;
  /**
   * Poza suma „Poza sprintem" z innego powodu niz cecha: odlozone nie sa w ogole
   * liczone do rejestru. Kafelek stoi w grupie „Poza sumą", jako pierwszy.
   */
  note?: boolean;
  /** Cecha, nie stan: kafelek stoi w grupie „Poza sumą", poza rozbiciem „Poza sprintem". */
  separate?: boolean;
  /** Stan, ktory wchodzi do SUMY „Poza sprintem" — kafelki z tym znacznikiem sumuja sie do niej. */
  inSum?: boolean;
  /** Wzrost to zla wiadomosc (wiecej roboty). Dla sprintu kierunek nic nie znaczy. */
  riseIsBad: boolean;
}

const isOpen = (t: CounterTask, ctx: CounterCtx) => !ctx.closed.has(t.status);
/**
 * Status „Odlozone" (6). Audyt odlozonych nie rusza — leza poza kolejka, dopoki ktos
 * ich swiadomie nie wznowi — wiec nie wchodza do „Poza sprintem" ani do zadnego stanu.
 */
export const DEFERRED_STATUS = '6';
/** Otwarte i nieodlozone — to, czym audyt sie zajmuje. */
const inAudit = (t: CounterTask, ctx: CounterCtx) => isOpen(t, ctx) && t.status !== DEFERRED_STATUS;
const inSprint = (t: CounterTask, ctx: CounterCtx) =>
  ctx.sprintId !== null && t.sprintId === ctx.sprintId;
/** Rejestr do przerobienia: otwarte, nieodlozone, spoza aktywnego sprintu. */
const outside = (t: CounterTask, ctx: CounterCtx) => inAudit(t, ctx) && !inSprint(t, ctx);

const isStartu = (t: CounterTask) => hasTag(t, TAG_DO_STARTU);
/** DO-STARTU ma pierwszenstwo — zadanie z dwoma tagami gotowosci liczy sie raz. */
const isCzeka = (t: CounterTask) => !isStartu(t) && hasTag(t, TAG_CZEKA);
const wasAnswered = (t: CounterTask, ctx: CounterCtx) => ctx.answered?.has(t.id) ?? false;

/** Ma tag kategorii korzyści (jeden z `TAGS_KATEGORIA`) — widać to z samej listy zadań. */
export const hasCategory = (t: Pick<CounterTask, 'tags'>): boolean =>
  TAGS_KATEGORIA.some((g) => hasTag(t, g));

/** Wymóg i strategia nie mają okresu zwrotu — jedno ma termin, drugie uzasadnienie. */
export const needsPayback = (t: Pick<CounterTask, 'tags'>): boolean =>
  !hasTag(t, TAG_WYMOG) && !hasTag(t, TAG_STRATEGIA);

/**
 * Komplet z SAMEJ listy zadań (bez czatu): wycena, kategoria i — zależnie od kategorii —
 * tag okresu zwrotu albo termin.
 *
 *  - zwykłe zadanie: tag okresu zwrotu (ZWROT-3 / ZWROT-6 / ZWROT-12 / ZWROT-12+), który
 *    `wartosc.mjs` kopiuje z przedziału w wiadomości WARTOŚĆ,
 *  - WYMOG: termin (pole „Termin" zadania) — wymóg nie ma rankingu, ma datę,
 *  - STRATEGIA: z tagów sama się nie kompletuje — uzasadnienie siedzi w czacie (`ChatFacts.strategic`).
 */
export const isCompleteByTags = (t: CounterTask): boolean =>
  t.storyPoints != null &&
  hasCategory(t) &&
  !hasTag(t, TAG_STRATEGIA) &&
  (needsPayback(t) ? paybackBand(t) !== null : t.deadline != null);

/**
 * Rozpoznanie mieści się w 4 godzinach (`gotowe.mjs --rozpoznanie`). Poznajemy je po dopisku w
 * wiadomości WYCENA albo — jak w audycie — po tytule („rozpoznanie…", „weryfikacja…") przy wycenie do 4 h.
 */
export const RECON_MAX_HOURS = 4;
export const isReconByTitle = (t: Pick<CounterTask, 'title' | 'storyPoints'>): boolean =>
  t.storyPoints != null && t.storyPoints <= RECON_MAX_HOURS && /rozpoznani|weryfikacj/i.test(t.title);

/** Zadanie, którego kompletność rozstrzyga czat: może być rozpoznaniem albo strategią z uzasadnieniem. */
export const needsChat = (t: CounterTask): boolean =>
  t.storyPoints != null &&
  !isReconByTitle(t) &&
  ((t.storyPoints <= RECON_MAX_HOURS && !isCompleteByTags(t)) || hasTag(t, TAG_STRATEGIA));

/**
 * Czy zadanie z DO-STARTU ma komplet: kompletne w tagach, rozpoznanie (po tytule albo z czatu) albo
 * strategia z uzasadnieniem. Dopóki czaty się czytają (`chat === null`), zadanie, które od nich zależy,
 * nie jest jeszcze ani kompletne, ani niekompletne — kafelki dostają wtedy znak „liczę" (`needsChatFacts`).
 */
const isComplete = (t: CounterTask, ctx: CounterCtx) =>
  isCompleteByTags(t) ||
  (t.storyPoints != null &&
    (isReconByTitle(t) ||
      (ctx.chat?.recon.has(t.id) ?? false) ||
      (hasTag(t, TAG_STRATEGIA) && (ctx.chat?.strategic.has(t.id) ?? false))));

/*
 * Kolejnosc = kolejnosc pracy w audycie: skala rejestru, potem stany od „trzeba zapytac"
 * po „gotowe", na koncu sprint jako punkt odniesienia i notka o odlozonych.
 */
export const COUNTERS: CounterDef[] = [
  {
    key: 'poza',
    label: 'Poza sprintem',
    hint:
      'Otwarte zadania spoza aktywnego sprintu, bez odłożonych — cały rejestr, niezależnie ' +
      'od widoku i filtrów. Kafelki obok rozbijają tę liczbę co do sztuki.',
    match: (t, ctx) => outside(t, ctx),
    riseIsBad: true,
  },
  {
    key: 'wywiad',
    inSum: true,
    label: 'Do wywiadu',
    hint:
      'Poza sprintem: z tagiem DO-WYWIADU albo jeszcze bez tagu gotowości (nowe) — ' +
      'trzeba zadać pytania.',
    match: (t, ctx) => outside(t, ctx) && !isStartu(t) && !hasTag(t, TAG_CZEKA),
    riseIsBad: true,
  },
  {
    key: 'czeka',
    inSum: true,
    label: 'Czeka na odpowiedź',
    hint:
      'Poza sprintem, z tagiem OCZEKUJE-NA-ODPOWIEDZ, a po naszych pytaniach nikt spoza IT ' +
      'jeszcze nie odpisał — piłka po stronie zgłaszającego.',
    match: (t, ctx) => outside(t, ctx) && isCzeka(t) && !wasAnswered(t, ctx),
    riseIsBad: true,
  },
  {
    key: 'odpowiedzi',
    inSum: true,
    label: 'Do analizy odpowiedzi',
    hint:
      'OCZEKUJE-NA-ODPOWIEDZ, a po naszych pytaniach ktoś spoza IT odpisał z treścią — ' +
      'daj DO-STARTU albo dopytaj.',
    match: (t, ctx) => outside(t, ctx) && isCzeka(t) && wasAnswered(t, ctx),
    riseIsBad: true,
  },
  {
    key: 'wycena',
    inSum: true,
    label: 'Do wyceny',
    hint:
      'Poza sprintem, z tagiem DO-STARTU, ale bez kompletu: brakuje story pointów, ' +
      'kategorii korzyści albo tagu okresu zwrotu (ZWROT-3 … ZWROT-12+). WYMOG potrzebuje ' +
      'terminu zamiast zwrotu, STRATEGIA — uzasadnienia w wiadomości WARTOŚĆ, rozpoznanie nie ' +
      'potrzebuje żadnego z nich — uzupełnij wycenę i wartość.',
    match: (t, ctx) => outside(t, ctx) && isStartu(t) && !isComplete(t, ctx),
    needsMeta: true,
    needsChatFacts: true,
    riseIsBad: true,
  },
  {
    key: 'gotowe',
    inSum: true,
    label: 'Gotowe do startu',
    hint:
      'Poza sprintem, z tagiem DO-STARTU i kompletem: wycena, kategoria korzyści i okres ' +
      'zwrotu (WYMOG: termin; STRATEGIA: uzasadnienie; rozpoznanie: sama wycena) — można je wziąć ' +
      'do sprintu.',
    match: (t, ctx) => outside(t, ctx) && isStartu(t) && isComplete(t, ctx),
    needsMeta: true,
    needsChatFacts: true,
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
  {
    key: 'bug',
    label: 'Błędy',
    hint:
      'Otwarte zadania z tagiem BUG (bez odłożonych) — w sprincie i poza nim. To cecha, a nie ' +
      'stan: zadanie z BUG jest też w jednym ze stanów obok, więc kafelek nie wchodzi do sumy.',
    match: (t, ctx) => inAudit(t, ctx) && hasTag(t, TAG_BUG),
    separate: true,
    riseIsBad: true,
  },
  {
    key: 'koncept',
    label: 'Koncept',
    hint:
      'Otwarte zadania z tagiem KONCEPT (albo starszym KONCEPCJA), bez odłożonych — w sprincie i ' +
      'poza nim. To cecha, a nie stan: takie zadanie jest też w jednym ze stanów obok, więc ' +
      'kafelek nie wchodzi do sumy.',
    match: (t, ctx) => inAudit(t, ctx) && TAGS_KONCEPT.some((g) => hasTag(t, g)),
    separate: true,
    riseIsBad: false,
  },
  {
    key: 'odlozone',
    label: 'Odłożone',
    hint: 'Zadania odłożone (status „Odłożone”) spoza sprintu — nie wchodzą do sumy „Poza sprintem”.',
    match: (t, ctx) => isOpen(t, ctx) && t.status === DEFERRED_STATUS && !inSprint(t, ctx),
    note: true,
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

/** Przedział okresu zwrotu, od najlepszego do najgorszego. */
export type PaybackBand = 'do3' | '3-6' | '6-12' | 'ponad12';

/**
 * Przedziały i ich tagi na zadaniu. Liczba w tagu to GÓRNA granica przedziału; `ZWROT-12+` to
 * ponad 12 miesięcy albo „nie da się policzyć". Tag jest kopią przedziału z wiadomości WARTOŚĆ
 * i to z niego czytamy — bez wchodzenia w czat.
 */
export const PAYBACK_BANDS: { key: PaybackBand; label: string; tag: string }[] = [
  { key: 'do3', label: 'do 3 mies.', tag: 'ZWROT-3' },
  { key: '3-6', label: '3–6 mies.', tag: 'ZWROT-6' },
  { key: '6-12', label: '6–12 mies.', tag: 'ZWROT-12' },
  { key: 'ponad12', label: 'ponad 12 mies.', tag: 'ZWROT-12+' },
];

/**
 * Przedział okresu zwrotu z tagów zadania. Gdyby zadanie miało dwa tagi zwrotu (skrypt podmienia
 * stary, ale ręczna zmiana potrafi zostawić oba), liczy się NAJGORSZY — lepiej nie obiecać za dużo.
 */
export function paybackBand(t: Pick<Task, 'tags'>): PaybackBand | null {
  let worst = -1;
  for (const g of t.tags) {
    const i = PAYBACK_BANDS.findIndex((b) => b.tag === g.toUpperCase());
    if (i > worst) worst = i;
  }
  return worst < 0 ? null : PAYBACK_BANDS[worst].key;
}

/**
 * Miejsce zadania w sortowaniu „po zwrocie" — mniejsza liczba idzie wyżej.
 *
 *   0    WYMOG (ma termin, wchodzi poza rankingiem, więc na początku)
 *   1    STRATEGIA (bez liczb, o kolejności decyduje rada — więc osobnym blokiem tuż po wymogach,
 *        a nie wciśnięta w któryś przedział)
 *   2–5  przedział: do 3, 3–6, 6–12, ponad 12 miesięcy
 *   6    brak okresu zwrotu (jeszcze niepoliczony) — na końcu
 */
export function paybackRank(t: Pick<Task, 'tags'>): number {
  if (hasTag(t, TAG_WYMOG)) return 0;
  if (hasTag(t, TAG_STRATEGIA)) return 1;
  const band = paybackBand(t);
  return band ? 2 + PAYBACK_BANDS.findIndex((b) => b.key === band) : PAYBACK_BANDS.length + 2;
}

/**
 * Dopisek w wiadomości WYCENA przy rozpoznaniu i analizie błędu (`gotowe.mjs --rozpoznanie`):
 * „Rozpoznanie — bez okresu zwrotu". Starsze wyceny nie mają dopisku, tylko uzasadnienie zaczynające
 * się od „Rozpoznanie / Weryfikacja / Przegląd kodu / Sprawdzenie" — audyt czyta obie postaci, więc
 * my też. Po nich krok 9 audytu pomija zadanie, a binear uznaje je za komplet bez kategorii i zwrotu.
 */
export const RECON_MARKER =
  /rozpoznanie\s*[-–—]\s*bez okresu zwrotu|co obejmuje ta wycena\s*(?:rozpoznanie|weryfikacja|przegl[ąa]d kodu|sprawdzenie)/i;

/** Czy któraś z wiadomości (system pomijamy) oznacza zadanie jako rozpoznanie. */
export function hasReconMarker(messages: ChatMessage[]): boolean {
  return messages.some((m) => m.authorId > 0 && RECON_MARKER.test(plainBody(m.text)));
}

/**
 * Wiadomość „WARTOŚĆ" w czacie zadania — początek wiadomości po zdjęciu znaczników, bez względu na
 * wielkość liter i polskie znaki: „WARTOŚĆ: strategia", „[B]Wartość[/B] …". Dla STRATEGII to jedyny
 * ślad uzasadnienia, bo takie zadanie nie ma tagu ZWROT.
 */
export const VALUE_MESSAGE = /^warto[śs][ćc](?=$|[\s:.,;\-–—])/i;

/** Czy któraś z wiadomości (system pomijamy) to wiadomość WARTOŚĆ. */
export function hasValueMessage(messages: ChatMessage[]): boolean {
  return messages.some((m) => m.authorId > 0 && VALUE_MESSAGE.test(plainBody(m.text)));
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
