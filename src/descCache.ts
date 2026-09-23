/*
 * OPISY zadan — osobny magazyn, pobierany WYLACZNIE na zadanie.
 *
 * Wyszukiwarka widzi dzis kod, numer, tytul i tagi. Opisow nie, bo nie ma ich
 * w danych listy (`LIST_SELECT`). Naturalny odruch — zrzucic filtrowanie na
 * Bitrix — jest PULAPKA: filtr `%DESCRIPTION` nie zglasza bledu, tylko po cichu
 * ignoruje warunek i oddaje WSZYSTKIE zadania. Sprawdzone na portalu: fraza
 * `zzzqqqxxx-nie-istnieje` dala 1318 trafien z 1318 zadan, podczas gdy `%TITLE`
 * z ta sama fraza dal zero. Gdyby to wdrozyc bez proby na bzdurnej frazie,
 * wygladaloby na dzialajace.
 *
 * Zostaje przeszukiwanie po stronie przegladarki. Dlatego NIE dokladamy opisow
 * do zwyklego pobrania listy: `tasks.task.list` oddaje je chetnie, ale kosztuja
 * okolo 1,9 MB na projekt (1318 zadan, mediana 1187 znakow, 49 na 50 zadan ma
 * opis). Lista pobiera sie przy kazdym uruchomieniu; opisy maja sie pobrac raz
 * i tylko wtedy, gdy ktos naprawde chce w nich szukac.
 *
 * Wlasna baza, nie wspolna z `listCache` — ta sama zasada co tam: dwa magazyny
 * w jednej bazie musialyby uzgadniac numer wersji przy kazdej zmianie schematu
 * jednego z nich.
 */

const DB = 'binear-opisy';
const STORE = 'opisy';
/** Tyle projektow pamietamy naraz — jak w `listCache`. */
const CAP = 6;

/** Jeden opis: tresc i znacznik zmiany, po ktorym poznajemy nieaktualnosc. */
export interface Opis {
  d: string;
  ch: string | null;
}

interface Wpis {
  groupId: number;
  zapisano: number;
  /** Pary zamiast `Map` — patrz uzasadnienie w `listCache`. */
  pozycje: [number, Opis][];
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
    req.onblocked = () => reject(new Error('IndexedDB zablokowane przez inne połączenie'));
  });
}

async function praca<T>(
  tryb: IDBTransactionMode,
  co: (s: IDBObjectStore) => IDBRequest,
): Promise<T | null> {
  let db: IDBDatabase | null = null;
  try {
    db = await otworz();
    const polaczenie = db;
    return await new Promise<T | null>((resolve) => {
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
    db?.close();
    return null;
  }
}

/** Opisy zapisane dla projektu, albo `null` gdy nigdy ich nie pobrano. */
export async function wczytajOpisy(groupId: number): Promise<Map<number, Opis> | null> {
  const wpis = await praca<Wpis>('readonly', (s) => s.get(groupId));
  if (!wpis) return null;
  /* Rekord sprzed zmiany ksztaltu typu wroci bez `pozycje` — `new Map(undefined)`
     rzuca, a zly rekord zostalby w bazie do nastepnego razu. Kasujemy. */
  if (!Array.isArray(wpis.pozycje)) {
    await praca('readwrite', (s) => s.delete(groupId));
    return null;
  }
  return new Map(wpis.pozycje);
}

/*
 * Znaczniki czasu trzymamy OBOK bazy, w `localStorage` — dokladnie jak
 * `listCache`. Do wybrania, ktory projekt wyrzucic, potrzebna jest sama data,
 * a `getAll()` musialby w tym celu zdeserializowac KOMPLET zapisanych opisow
 * (do szesciu projektow po okolo 1,9 MB). Tutaj jest to jeszcze grubszy blad
 * niz tam, bo opisy sa wieksze od migawek listy.
 */
const WIEKI = 'binear.desc.meta';

function wieki(): Record<string, number> {
  try {
    const p = JSON.parse(localStorage.getItem(WIEKI) || '{}');
    return p && typeof p === 'object' ? (p as Record<string, number>) : {};
  } catch {
    return {};
  }
}

export async function zapiszOpisy(groupId: number, opisy: Map<number, Opis>): Promise<void> {
  const wpis: Wpis = { groupId, zapisano: Date.now(), pozycje: [...opisy] };
  await praca('readwrite', (s) => s.put(wpis));

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
    localStorage.setItem(WIEKI, JSON.stringify(meta));
  } catch {
    /* Bez znacznikow limit przestanie dzialac, ale same opisy sa juz zapisane. */
  }
}
