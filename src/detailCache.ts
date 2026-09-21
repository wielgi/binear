/*
 * Cache szczegolow zadania (opis, checklista, wspolwykonawcy…). Szczegoly ciagniemy
 * dopiero przy otwarciu zadania (`fetchTaskDetail`), wiec przy KAZDYM otwarciu byl
 * moment pustki. Trzymamy ostatnio ogladane w localStorage i przy ponownym otwarciu
 * pokazujemy je OD RAZU, a swieze dane dociagamy w tle i podmieniamy (stale-while-
 * revalidate). Id zadan sa globalne, wiec nie trzeba kluczowac po projekcie.
 */
import type { Comment, Person, TaskDetail } from './bitrix';

/**
 * Nienapisany do konca komentarz — wszystko, co trzeba, zeby wrocic do pisania
 * dokladnie tam, gdzie sie przerwalo.
 *
 * `mentioned` jedzie razem z tekstem, bo w polu stoi czytelne „@Imie", a na
 * znacznik `[USER=id]` zamieniamy dopiero przy wysylce — bez tej listy wzmianka
 * po powrocie bylaby juz tylko napisem i nikogo by nie powiadomila.
 */
export interface CommentDraft {
  text: string;
  mentioned: Person[];
  /** Na kogo odpowiadamy; cytat doklejamy dopiero przy wysylce. */
  replyTo: { author: string; when: string; body: string } | null;
  /** Rozpisane poprawki WLASNYCH komentarzy: klucz komentarza → tresc pola. */
  edits: Record<string, string>;
  /**
   * Osoby wybrane z listy `@` w trakcie poprawki, per komentarz.
   *
   * Pole DOPISANE pozniej i dlatego opcjonalne: starsze szkice go nie maja,
   * a `usable` go nie wymaga — brak znaczy „nikogo nie wybrano", co jest
   * prawda. Gdyby byl wymagany, podniesienie `.vN` unicestwiloby wszystkie
   * niewyslane komentarze, czyli jedyna rzecz w tym magazynie, ktorej nie da
   * sie odtworzyc z Bitriksa.
   */
  editMentions?: Record<string, Person[]>;
}

/** Ile ostatnio otwartych zadan trzymamy — reszta wypada (LRU po czasie zapisu). */
const CAP = 80;

/*
 * Jeden lekki cache LRU per rodzaj danych (szczegoly, komentarze). Klucz = id zadania,
 * wartosc = dane + znacznik czasu ostatniego zapisu (do wyrzucania najstarszych).
 */
function makeCache<T>(storageKey: string, usable: (value: T) => boolean) {
  type Entry = { value: T; ts: number };
  let store: Record<string, Entry> | null = null;

  const load = (): Record<string, Entry> => {
    if (store) return store;
    try {
      store = JSON.parse(localStorage.getItem(storageKey) || '{}') as Record<string, Entry>;
    } catch {
      store = {};
    }
    return store;
  };

  return {
    get(id: number): T | null {
      const value = load()[id]?.value ?? null;
      /*
       * Druga linia obrony przy numerze wersji: wpis, ktoremu brakuje pol dzisiejszego
       * ksztaltu, traktujemy jak PUDLO w cache, a nie jak dane. Podniesienie `.vN`
       * zalatwia sprawe tylko wtedy, gdy sie o nim pamieta — a nie pamieta sie zawsze
       * (ten plik ma juz na koncie dwie awarie z tego powodu). Koszt pudla to jedno
       * pobranie, koszt przeoczenia to wywalony panel u uzytkownika.
       */
      if (value === null) return null;
      try {
        return usable(value) ? value : null;
      } catch {
        return null;
      }
    },
    remove(id: number): void {
      const s = load();
      if (!(id in s)) return;
      delete s[id];
      try {
        localStorage.setItem(storageKey, JSON.stringify(s));
      } catch {
        // jak przy zapisie — brak miejsca nie moze wywalic widoku
      }
    },
    set(id: number, value: T): void {
      const s = load();
      s[id] = { value, ts: Date.now() };

      const ids = Object.keys(s);
      if (ids.length > CAP) {
        ids
          .sort((a, b) => s[a].ts - s[b].ts)
          .slice(0, ids.length - CAP)
          .forEach((k) => delete s[k]);
      }

      try {
        localStorage.setItem(storageKey, JSON.stringify(s));
      } catch {
        // brak miejsca / tryb prywatny — cache po prostu nie przezyje odswiezenia
      }
    },
  };
}

/*
 * KONCOWKA `.vN` W KLUCZU TO NIE OZDOBA. Cache czyta `JSON.parse` i rzutuje wynik na
 * typ, wiec TypeScript go NIE sprawdza: wpisy zapisane przed zmiana ksztaltu typu
 * wracaja bez nowych pol i wywalaja widok dopiero w przegladarce, u kogos, kto ma
 * stary localStorage. Zmieniasz `TaskDetail` albo `Comment` — PODNIES numer, wtedy
 * stare wpisy przestaja byc czytane i dociagaja sie na nowo (to tylko cache).
 *
 * v2 komentarzy: doszlo pole `files` (zalaczniki z czatu).
 */
const details = makeCache<TaskDetail>(
  'binear.details.v2',
  // v2: doszlo `attachments` (pliki doczepione do zadania).
  (d) => Array.isArray(d?.attachments),
);
const comments = makeCache<Comment[]>(
  'binear.comments.v3',
  // v2: doszlo `files` (zalaczniki komentarza z czatu).
  (list) => Array.isArray(list) && list.every((c) => Array.isArray(c?.files)),
);

/* Klucz po podniesieniu wersji nie zniknie sam, a to nawet kilkaset kilobajtow
   martwych komentarzy w localStorage. Sprzatamy przy pierwszym imporcie modulu. */
try {
  localStorage.removeItem('binear.comments.v1');
  localStorage.removeItem('binear.details.v1');
  /*
   * `.v2` komentarzy bywa ZATRUTE: przy szybkim przelaczaniu zadan zapisywal sie
   * tam watek innego zadania (patrz `mine` w panelu szczegolow). Ksztalt danych sie
   * nie zmienil, ale tresci nie da sie zweryfikowac, wiec jedyne wyjscie to zaczac
   * od zera — koszt to jedno pobranie przy nastepnym otwarciu.
   */
  localStorage.removeItem('binear.comments.v2');
} catch {
  // tryb prywatny / brak dostepu — nie ma czego sprzatac
}

export const getCachedDetail = (id: number) => details.get(id);
export const setCachedDetail = (id: number, detail: TaskDetail) => details.set(id, detail);

/* Komentarze: istniejace sie NIE zmieniaja, dochodza tylko nowe — wiec cache jest
   bezpieczny; pokazujemy stare od razu, a swieze pobranie dokłada ewentualne nowe. */
export const getCachedComments = (id: number) => comments.get(id);
export const setCachedComments = (id: number, list: Comment[]) => comments.set(id, list);

/*
 * NIEWYSLANE komentarze. Panel szczegolow montuje sie od nowa przy kazdym zadaniu
 * (`key={task.id}`), wiec bez tego zamkniecie zadania w polowie zdania kasowalo
 * zdanie. Tu chodzi o cudzy tekst wlasnej reki — jedyna rzecz w panelu, ktorej
 * NIE da sie odtworzyc z Bitriksa, bo jeszcze tam nie dotarla.
 */
const drafts = makeCache<CommentDraft>(
  'binear.drafts.v1',
  (d) =>
    typeof d?.text === 'string' &&
    Array.isArray(d?.mentioned) &&
    typeof d?.edits === 'object' &&
    d.edits !== null,
);

export const getDraft = (id: number) => drafts.get(id);
export const setDraft = (id: number, draft: CommentDraft) => drafts.set(id, draft);
export const clearDraft = (id: number) => drafts.remove(id);
