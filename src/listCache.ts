/*
 * Migawka LISTY zadan — zeby zimny start nie zaczynal sie od pustego ekranu.
 *
 * Szczegoly zadania i komentarze maja swoj cache (`detailCache`) i dlatego panel
 * otwiera sie od razu. Lista go nie miala: kazde uruchomienie musialo przejsc
 * cala droge — konfiguracja, sprinty, etapy, zadania, epiki, story pointy — i
 * przez te kilka sekund nie bylo czego pokazac.
 *
 * Widac to bylo nie tylko przy pierwszym wejsciu. Karta zostawiona na dluzej
 * potrafi zostac przeladowana bez udzialu uzytkownika (serwer deweloperski po
 * zerwaniu polaczenia, przegladarka usypiajaca karty w tle), a wtedy powrot na
 * nia wyglada jak zniknieciecie calego widoku — zgloszenie #4 „Migający widok".
 * Odswiezanie w tle bylo juz zrobione i dziala; problemem byl START.
 *
 * DLACZEGO IndexedDB, a nie `localStorage` jak reszta cache'u: migawka grupy IT
 * SCRUM to 1294 zadania i **1,2 MB** tekstu. `localStorage` ma okolo 5 MB na
 * CALE zrodlo — dziennik zmian, zapisane widoki, cache komentarzy i szczegolow
 * mieszkaja w tym samym budzecie. Jeden projekt zjadlby czwarta czesc, kilka
 * wysadziloby zapis czegokolwiek innego. IndexedDB liczy limit w setkach
 * megabajtow i trzyma dane bez przepisywania calosci przy kazdym zapisie.
 *
 * Kosztem jest asynchronicznosc: stan poczatkowy nie moze juz przeczytac migawki
 * synchronicznie, wiec pierwsza klatka jest pusta. Chodzi o milisekundy, a nie
 * o sekundy pelnego pobrania — czyli dokladnie o to, co bylo do naprawienia.
 *
 * Trzymamy WYLACZNIE to, czego nie da sie wyliczyc. Mapy (`stageNames`,
 * `stageOrder`, `stageMeta`, `epicNames`) ida jako pary — struktura klonowana
 * przez IndexedDB radzi sobie z `Map`, ale pary sa czytelne i odporne na zmiane
 * magazynu, gdyby kiedys wrocil pod `JSON`.
 */
import type { AppConfig, Epic, FieldEnums, Project, Sprint, Stage, Task } from './bitrix';

/*
 * Wlasna baza, a nie wspolna z `pasteStore`. Dwa niezalezne magazyny w jednej
 * bazie musialyby uzgadniac numer wersji przy kazdej zmianie schematu jednego
 * z nich — a to jest dokladnie ten rodzaj sprzezenia, ktory pozniej wybucha przy
 * niepowiazanej zmianie.
 */
const DB = 'binear-listy';
const STORE = 'migawki';
/** Ile projektow pamietamy — wiecej niz ktokolwiek przelacza w jednym dniu. */
const CAP = 12;

/*
 * BEZ TERMINU WAZNOSCI — i to jest decyzja, nie przeoczenie.
 *
 * Migawka stoi na ekranie do czasu, az dojda swieze dane, czyli sekunde. Wiek
 * nie czyni jej grozniejsza: tydzien stara lista miga tak samo krotko jak
 * wczorajsza i tak samo zaraz znika.
 *
 * Termin waznosci uderzalby za to dokladnie w przypadek, dla ktorego to powstalo:
 * karta zostawiona na weekend, przeladowana przez serwer deweloperski — czyli
 * migawka najstarsza i najbardziej potrzebna. Naprawilbym blad dla wszystkich
 * poza tym, kto zglasza go najczesciej.
 *
 * Sytuacje naprawde grozna — „swieze dane NIGDY nie doszly" — pilnuje co innego:
 * nieudane pobranie przy starcie zapala ramke „Nie udalo sie pobrac zadan" obok
 * listy, wiec nikt nie ogląda starych danych w przekonaniu, ze sa dzisiejsze.
 */

export interface ListSnapshot {
  tasks: Task[];
  stages: Stage[];
  stageNames: [number, string][];
  stageOrder: [string, number][];
  stageMeta: [number, { color: string | null; progress: number | null }][];
  labels: FieldEnums;
  activeSprint: Sprint | null;
  sprints: Sprint[];
  backlogId: number | null;
  config: AppConfig | null;
  projects: Project[];
  epics: Epic[];
  epicNames: [number, Epic][];
  groupId: number | null;
}

interface Wpis {
  groupId: number;
  value: ListSnapshot;
  ts: number;
}

function otworz(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'groupId' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    /*
     * Bez tego obietnica nie rozwiazuje sie NIGDY, gdy podniesienie wersji czeka
     * na inne otwarte polaczenie — a wtedy odczyt migawki wisi w nieskonczonosc
     * i lista nie pokazuje sie wcale. Odmowa jest lepsza niz zawieszenie.
     */
    req.onblocked = () => reject(new Error('IndexedDB zablokowane przez inne połączenie'));
  });
}

/*
 * Kazda operacja opakowana: tryb prywatny, brak miejsca albo zablokowany magazyn
 * nie moga wywalic widoku. Migawka jest WYGODA, nie zrodlem prawdy — bez niej
 * start wyglada tak, jak wygladal wczesniej.
 */
async function praca<T>(tryb: IDBTransactionMode, co: (s: IDBObjectStore) => IDBRequest): Promise<T | null> {
  let db: IDBDatabase | null = null;
  try {
    db = await otworz();
    const polaczenie = db;
    return await new Promise<T | null>((resolve) => {
      /*
       * Baze zamykamy w KAZDEJ sciezce, nie tylko w `oncomplete`. Przy bledzie
       * transakcja sie przerywa, `oncomplete` nie pada — a `otworz` otwiera nowe
       * polaczenie przy kazdej operacji, wiec niezamkniete zaczynaja sie zbierac.
       * Kazde zywe polaczenie blokuje pozniejsze podniesienie wersji schematu.
       */
      const zamknij = () => polaczenie.close();
      const t = polaczenie.transaction(STORE, tryb);
      const req = co(t.objectStore(STORE));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => resolve(null);
      t.oncomplete = zamknij;
      t.onabort = zamknij;
      t.onerror = zamknij;
    });
  } catch {
    /* Blad SYNCHRONICZNY z `co()` (np. niepoprawny klucz) tez zostawilby polaczenie. */
    db?.close();
    return null;
  }
}

/**
 * `groupId === null` znaczy „nikt nie wybral projektu recznie" — czyli uzywamy
 * domyslnego z `.env`, ktorego w tym momencie jeszcze nie znamy (przychodzi
 * z `/api/config`, czyli po sieci). Wtedy bierzemy NAJSWIEZSZA migawke: to ta,
 * ktora uzytkownik widzial ostatnio, a jesli zgadniemy zle, prawdziwe dane i tak
 * ja za chwile zastapia.
 */
export async function wczytajListe(groupId: number | null): Promise<ListSnapshot | null> {
  /*
   * Bez wybranego projektu siegamy po WSKAZNIK, a nie po `getAll()`. Ten drugi
   * deserializowal wszystkie migawki naraz — do dwunastu po ponad megabajcie —
   * zeby wybrac z nich jedna, i robil to na sciezce, ktora ta zmiana ma SKROCIC.
   */
  const klucz = groupId ?? ostatniKlucz();
  if (klucz === null) return null;

  const wpis = await praca<Wpis>('readonly', (s) => s.get(klucz));
  if (!wpis) return null;

  /*
   * Wpis zapisany przed zmiana ksztaltu typu wroci bez nowych pol — a `JSON`
   * i klonowanie strukturalne nie sprawdzaja typow, wiec wywalilby sie dopiero
   * w przegladarce. Sprawdzamy WSZYSTKIE CZTERY pary: `new Map(cos-nie-tablica)`
   * rzuca wyjatek wewnatrz `setData`, a stamtad juz tylko ekran bledu — i to
   * SAMOPODTRZYMUJACY SIE, bo zly rekord zostaje w bazie do nastepnego razu.
   */
  const v = wpis.value;
  const pary = [v?.stageNames, v?.stageOrder, v?.stageMeta, v?.epicNames];
  if (!v || !Array.isArray(v.tasks) || !pary.every(Array.isArray)) {
    await praca('readwrite', (s) => s.delete(klucz));
    return null;
  }
  return v;
}

/**
 * Wskaznik na ostatnio zapisana migawke — maly klucz w `localStorage`, zeby
 * odczyt „bez wybranego projektu" byl jednym `get`, a nie pobraniem calosci.
 */
const WSKAZNIK = 'binear.list.last';

function ostatniKlucz(): number | null {
  try {
    const n = Number(localStorage.getItem(WSKAZNIK));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/**
 * Kiedy ktory projekt byl zapisany — SAME LICZBY, obok bazy.
 *
 * Wiek wpisu jest w rekordzie, ale zeby go stamtad przeczytac, trzeba wczytac
 * caly rekord razem z lista zadan. Do policzenia, ktore dwanascie zostawic,
 * wystarcza znaczniki — wiec trzymamy je osobno i limit nie kosztuje nic.
 */
const WIEKI = 'binear.list.meta';

function wieki(): Record<string, number> {
  try {
    const p = JSON.parse(localStorage.getItem(WIEKI) || '{}');
    return p && typeof p === 'object' ? (p as Record<string, number>) : {};
  } catch {
    return {};
  }
}

export async function zapiszListe(groupId: number | null, value: ListSnapshot): Promise<void> {
  if (groupId === null) return;
  await praca('readwrite', (s) => s.put({ groupId, value, ts: Date.now() } satisfies Wpis));

  const meta = wieki();
  const nowy = !(String(groupId) in meta);
  meta[String(groupId)] = Date.now();

  /* Ponad limit wypadaja najstarsze — sprawdzane tylko, gdy DOSZEDL nowy projekt. */
  if (nowy) {
    const klucze = Object.keys(meta);
    for (const k of klucze.sort((a, b) => meta[a] - meta[b]).slice(0, klucze.length - CAP)) {
      await praca('readwrite', (s) => s.delete(Number(k)));
      delete meta[k];
    }
  }

  try {
    localStorage.setItem(WSKAZNIK, String(groupId));
    localStorage.setItem(WIEKI, JSON.stringify(meta));
  } catch {
    /* Bez wskaznika odczyt bez wybranego projektu po prostu nic nie znajdzie. */
  }
}
