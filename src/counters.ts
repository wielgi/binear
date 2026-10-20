/*
 * Tagi procesu IT, gotowosc do startu i dzienna historia kafelkow.
 *
 * Wbudowane liczniki zastapily wlasne kafelki (zapisane widoki). Ich dawne zasady — rozbicie „Poza sprintem"
 * na Do wywiadu / Czeka / Do analizy odpowiedzi / Do wyceny / Gotowe, bez odlozonych, KONCEPCJA i folderow —
 * siedza teraz w filtrach domyslnego zestawu (`public/binear-kafelki-IT.json`). Tu zostaje to, czego filtr sam
 * nie wyrazi: gotowosc do startu (`readiness`, filtry „Gotowość" i „Brakuje"), fakty z czatow, odpowiedzi
 * zglaszajacych i historia dzien po dniu.
 *
 * Modul jest czysty (bez Reacta i bez zapytan), zeby dalo sie go przetestowac.
 */
import type { Task } from './bitrix';

export const TAG_DO_STARTU = 'DO-STARTU';
export const TAG_CZEKA = 'OCZEKUJE-NA-ODPOWIEDZ';
export const TAG_WYWIAD = 'DO-WYWIADU';
export const TAG_BUG = 'BUG';
/**
 * Pomysl, a nie zadanie do zrobienia — temat na etapie koncepcji (reguly zadan: tag KONCEPCJA).
 * Nie ma drugiego tagu o tym znaczeniu; `KONCEPT` nie istnieje ani w regulach, ani w Bitriksie.
 */
export const TAG_KONCEPCJA = 'KONCEPCJA';

/*
 * Kategoria korzyści zadania — jeden tag na zadanie. `BUG` jest kategorią „naprawa błędu"
 * i już istnieje jako tag; pozostałe to nowe tagi z zasad wartości zadań.
 */
export const TAG_WYMOG = 'WYMOG';
export const TAGS_KATEGORIA = [
  TAG_BUG,
  'OSZCZEDNOSC',
  'PRZYCHOD',
  'RYZYKO',
  'ANALITYKA',
  'UTRZYMANIE',
  TAG_WYMOG,
];

/**
 * PULA zadania — z czyjego budżetu godzin ono jest: ciągłość (utrzymanie), rdzeń (rozwój produktu)
 * albo dział (zamówione przez dział). Obowiązkowa: bez puli zadanie nigdy nie jest kompletne.
 * Kolejność listy rozstrzyga, gdy zadanie ma dwie — liczy się pierwsza.
 */
export const TAGS_PULA = ['CIAGLOSC', 'RDZEN', 'DZIAL'] as const;
export type Pula = (typeof TAGS_PULA)[number];

/**
 * Dawny tag STRATEGIA: wartosc strategiczna z wiadomosci WARTOŚĆ — to samo, co dzis znaczy pula RDZEN. Zadanie
 * z samym STRATEGIA (bez zadnej puli) liczymy wiec jako RDZEN, zamiast zrzucac je na koniec planowania
 * i do „Do wyceny" tylko dlatego, ze nikt jeszcze nie przepial tagu.
 */
export const TAG_STRATEGIA = 'STRATEGIA';

/** Pula zadania albo `null`. Zadanie ma najwyżej jedną; przy dwóch wygrywa pierwsza z `TAGS_PULA` (patrz `pule`). */
export const pula = (t: Pick<Task, 'tags'>): Pula | null =>
  TAGS_PULA.find((g) => hasTag(t, g)) ?? (hasTag(t, TAG_STRATEGIA) ? 'RDZEN' : null);

/** Ile tagow puli ma zadanie — wiecej niz jedna to blad oznaczenia (patrz brak `pule` w `readiness`). */
export const pule = (t: Pick<Task, 'tags'>): number => TAGS_PULA.filter((g) => hasTag(t, g)).length;

/** Bitrix nie rozroznia wielkosci liter w tagach — „do-startu" to ten sam tag. */
export const hasTag = (t: Pick<Task, 'tags'>, tag: string): boolean =>
  t.tags.some((g) => g.toUpperCase() === tag);


/**
 * Co wiemy z czatów zadań DO-STARTU:
 *  - `recon` — oznaczone jako rozpoznanie albo analiza błędu (dopisek w wiadomości WYCENA); takie
 *    zadanie jest gotowe bez kategorii i bez okresu zwrotu, bo wartość liczymy dopiero przy właściwym
 *    zadaniu, które z niego powstanie,
 *  - `value` — zadania z wiadomością WARTOŚĆ (pierwsza linia np. „WARTOŚĆ: rdzeń", „WARTOŚĆ: zwrot …",
 *    „WARTOŚĆ: wymóg"). Dla puli RDZEN to jedyny ślad wartości, bo takie zadanie nie ma ani
 *    kategorii, ani tagu ZWROT.
 */
export interface ChatFacts {
  recon: ReadonlySet<number>;
  value: ReadonlySet<number>;
  /**
   * Zadania, ktorych czat udalo sie przeczytac. Reszta (czat nieczytelny albo spoza zakresu odczytu, np. zadanie
   * bez DO-STARTU) jest NIEZNANA — readiness() oddaje dla nich `null` zamiast zgadywac „brak WARTOSC".
   */
  read: ReadonlySet<number>;
}

type CounterTask = Pick<
  Task,
  'id' | 'title' | 'status' | 'sprintId' | 'tags' | 'storyPoints' | 'epicId' | 'deadline' | 'priority'
>;

/**
 * Identyfikatory zadan, ktore sa FOLDERAMI: otwarte zadanie ma co najmniej jedno OTWARTE podzadanie.
 * „Otwarte" = niezamkniete (odlozone tez sie liczy — praca nadal wisi). Wymaga CALEJ listy, bo dziecko
 * moze lezec w innym sprincie niz rodzic.
 */
export function foldersOf(
  tasks: readonly Pick<Task, 'id' | 'parentId' | 'status'>[],
  closed: ReadonlySet<string>,
): Set<number> {
  const folders = new Set<number>();
  for (const t of tasks) if (t.parentId !== null && !closed.has(t.status)) folders.add(t.parentId);
  return folders;
}



/**
 * Status „Odlozone" (6). Audyt odlozonych nie rusza — leza poza kolejka, dopoki ktos
 * ich swiadomie nie wznowi — wiec nie wchodza do „Poza sprintem" ani do zadnego stanu.
 */
export const DEFERRED_STATUS = '6';

/** Ma tag kategorii korzyści (jeden z `TAGS_KATEGORIA`) — widać to z samej listy zadań. */
export const hasCategory = (t: Pick<CounterTask, 'tags'>): boolean =>
  TAGS_KATEGORIA.some((g) => hasTag(t, g));

/** Wymóg nie ma okresu zwrotu — ma termin. */
export const needsPayback = (t: Pick<CounterTask, 'tags'>): boolean => !hasTag(t, TAG_WYMOG);

/**
 * Komplet z SAMEJ listy zadań (bez czatu): pula, wycena i — dla CIAGLOSC i DZIAL — kategoria oraz
 * tag okresu zwrotu albo termin.
 *
 *  - bez puli: nigdy,
 *  - CIAGLOSC / DZIAL: kategoria + tag okresu zwrotu (ZWROT-3 / ZWROT-6 / ZWROT-12 / ZWROT-12+),
 *    który `wartosc.mjs` kopiuje z przedziału w wiadomości WARTOŚĆ; WYMOG ma zamiast zwrotu termin
 *    (pole „Termin" zadania) — wymóg nie ma rankingu, ma datę,
 *  - RDZEN: z tagów sam się nie kompletuje — wartość siedzi w wiadomości WARTOŚĆ w czacie
 *    (`ChatFacts.value`), kategoria i ZWROT nie są wymagane.
 */
export const isCompleteByTags = (t: CounterTask): boolean => {
  const p = pula(t);
  return (
    p !== null &&
    p !== 'RDZEN' &&
    t.storyPoints != null &&
    hasCategory(t) &&
    (needsPayback(t) ? paybackBand(t) !== null : t.deadline != null)
  );
};

/**
 * Rozpoznanie mieści się w 4 godzinach (`gotowe.mjs --rozpoznanie`). Poznajemy je po dopisku w
 * wiadomości WYCENA albo — jak w audycie — po tytule („rozpoznanie…", „weryfikacja…") przy wycenie do 4 h.
 */
export const RECON_MAX_HOURS = 4;
export const isReconByTitle = (t: Pick<CounterTask, 'title' | 'storyPoints' | 'tags'>): boolean =>
  pula(t) !== null &&
  t.storyPoints != null &&
  t.storyPoints <= RECON_MAX_HOURS &&
  /rozpoznani|weryfikacj/i.test(t.title);

/**
 * Zadanie, którego kompletność rozstrzyga czat: może być rozpoznaniem albo — z pulą RDZEN —
 * mieć wiadomość WARTOŚĆ. Bez puli czat niczego nie zmienia (zadanie i tak nie jest kompletne).
 */
export const needsChat = (t: CounterTask): boolean =>
  t.storyPoints != null &&
  pula(t) !== null &&
  !isReconByTitle(t) &&
  !isCompleteByTags(t) &&
  (t.storyPoints <= RECON_MAX_HOURS || pula(t) === 'RDZEN');

/** Czego brakuje zadaniu do kompletu — do filtra „Brakuje" (patrz `readiness`). */
export type Missing = 'pula' | 'pule' | 'sp' | 'kategoria' | 'zwrot' | 'termin' | 'wartosc';

export const MISSING_LABEL: Record<Missing, string> = {
  pula: 'Pula (CIAGLOSC / RDZEN / DZIAL)',
  pule: 'Jedna pula (zadanie ma dwie)',
  sp: 'Story points',
  kategoria: 'Kategoria',
  zwrot: 'Okres zwrotu (ZWROT-…)',
  termin: 'Termin (WYMOG)',
  wartosc: 'Wiadomość WARTOŚĆ (RDZEN)',
};

/**
 * Gotowosc zadania do startu wg tych samych zasad co dawny kafelek „Gotowe do startu" (`isComplete`), plus
 * lista brakow. `ready: null` = rozstrzyga czat, a czaty jeszcze sie czytaja (`chat === null`) — wtedy
 * zadanie nie jest ani gotowe, ani niegotowe, a `missing` podaje to, czego brakuje na pewno.
 *
 * Rozpoznanie (po tytule albo dopisku w czacie) jest gotowe z sama pula i wycena — reszta go nie dotyczy.
 */
export function readiness(t: CounterTask, chat: ChatFacts | null): { ready: boolean | null; missing: Missing[] } {
  const p = pula(t);
  const missing: Missing[] = [];
  if (p === null) missing.push('pula');
  // Dwie pule naraz to blad oznaczenia — nie zgadujemy, ktora miala byc; zadanie czeka na poprawke.
  if (pule(t) > 1) missing.push('pule');
  if (t.storyPoints == null) missing.push('sp');
  if (missing.length) return { ready: false, missing };

  if (isReconByTitle(t) || (chat?.recon.has(t.id) ?? false)) return { ready: true, missing: [] };
  // Czat, ktory moze rozstrzygnac (WARTOSC, dopisek rozpoznania), a nie zostal przeczytany: wynik nieznany.
  const unknown = needsChat(t) && !(chat?.read.has(t.id) ?? false);

  if (p === 'RDZEN') {
    if (unknown) return { ready: null, missing: [] };
    if (!(chat?.value.has(t.id) ?? false)) missing.push('wartosc');
  } else {
    if (!hasCategory(t)) missing.push('kategoria');
    if (needsPayback(t) ? paybackBand(t) === null : t.deadline == null) missing.push(needsPayback(t) ? 'zwrot' : 'termin');
  }
  // Male zadanie bez kompletu moze byc jeszcze rozpoznaniem z dopiskiem w czacie.
  if (missing.length && unknown) return { ready: null, missing };
  return { ready: missing.length === 0, missing };
}

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
 *   1–4  przedział: do 3, 3–6, 6–12, ponad 12 miesięcy
 *   5    brak okresu zwrotu (jeszcze niepoliczony, albo RDZEN) — na końcu
 */
export function paybackRank(t: Pick<Task, 'tags'>): number {
  if (hasTag(t, TAG_WYMOG)) return 0;
  const band = paybackBand(t);
  return band ? 1 + PAYBACK_BANDS.findIndex((b) => b.key === band) : PAYBACK_BANDS.length + 1;
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
 * wielkość liter i polskie znaki: „WARTOŚĆ: rdzeń", „[B]Wartość[/B] …". Dla puli RDZEN to jedyny
 * ślad wartości, bo takie zadanie nie ma ani kategorii, ani tagu ZWROT.
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
/** Wartosci dnia: kafelki (`t:<id>`), sumy grup (`g:`/`gs:`); starsze klucze dawnych licznikow zostaja w zapisie. */
export type DaySnapshot = Partial<Record<string, number>>;
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
