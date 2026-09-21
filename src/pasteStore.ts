/*
 * Wklejone zrzuty czekajace na wyslanie — trzymane w IndexedDB, nie w localStorage.
 *
 * Tekst komentarza mieszka w `detailCache` (localStorage) i to wystarcza, bo wazy
 * bajty. Obrazek nie: zrzut ekranu to setki kilobajtow, a w `localStorage` trzeba
 * by go jeszcze zamienic na base64, czyli urosnac o kolejna jedna trzecia — przy
 * limicie kilku megabajtow NA WSZYSTKO (dziennik, widoki, cache komentarzy)
 * pierwszy wiekszy zrzut wysadzilby caly magazyn.
 *
 * IndexedDB trzyma `Blob` w oryginale, bez przekodowania, i ma limit liczony
 * w setkach megabajtow. Dlatego zalaczniki ida tutaj, a nie tam, gdzie tekst.
 */

const DB = 'binear';
const STORE = 'wklejone';
/** Po tylu dniach niewyslany zrzut przestaje byc czymkolwiek poza smieciem. */
const TTL_DNI = 7;

interface Wpis {
  taskId: number;
  items: { name: string; blob: Blob }[];
  ts: number;
}

function otworz(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'taskId' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/*
 * Kazda operacja opakowana: tryb prywatny, brak miejsca albo zablokowany magazyn
 * nie moga wywalic panelu. Najgorsze, co sie stanie, to zrzut nieprzezywajacy
 * zamkniecia zadania — czyli dokladnie to, co bylo wczesniej.
 */
async function zTransakcja<T>(tryb: IDBTransactionMode, praca: (s: IDBObjectStore) => IDBRequest): Promise<T | null> {
  try {
    const db = await otworz();
    return await new Promise<T | null>((resolve) => {
      const t = db.transaction(STORE, tryb);
      const req = praca(t.objectStore(STORE));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => resolve(null);
      t.oncomplete = () => db.close();
    });
  } catch {
    return null;
  }
}

export async function wczytajWklejone(taskId: number): Promise<{ name: string; blob: Blob }[]> {
  const wpis = await zTransakcja<Wpis>('readonly', (s) => s.get(taskId));
  if (!wpis || !Array.isArray(wpis.items)) return [];
  /* Przeterminowane sprzatamy przy pierwszym siegnieciu — nie ma potrzeby
     osobnego przegladu calego magazynu. */
  if (Date.now() - wpis.ts > TTL_DNI * 86400000) {
    void wyczyscWklejone(taskId);
    return [];
  }
  return wpis.items;
}

export async function zapiszWklejone(taskId: number, items: { name: string; blob: Blob }[]): Promise<void> {
  if (!items.length) return void (await wyczyscWklejone(taskId));
  await zTransakcja('readwrite', (s) => s.put({ taskId, items, ts: Date.now() } satisfies Wpis));
}

export async function wyczyscWklejone(taskId: number): Promise<void> {
  await zTransakcja('readwrite', (s) => s.delete(taskId));
}
