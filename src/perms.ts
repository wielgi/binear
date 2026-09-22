/*
 * Co ten webhook w ogole potrafi — lista do sprawdzenia w panelu opcji.
 *
 * Po co: binear da sie uruchomic na dowolnym webhooku, a wtedy pierwsze pytanie
 * brzmi „czego mu brakuje". Dotad odpowiedz wymagala recznego strzelania
 * `curl`-em do kilkunastu metod i czytania kodow bledu. Panel robi to samo
 * w kilka sekund i tlumaczy wynik na zdanie, z ktorym da sie pojsc do
 * administratora.
 *
 * Grupujemy po SKUTKU, nie po module: interesuje nas „co przestanie dzialac",
 * a nie „ktorego uprawnienia brakuje". Nazwa modulu i tak jest w nazwie metody.
 *
 * Wszystkie pozycje sa sprawdzane BEZ PARAMETROW (patrz `probeMethod`), wiec
 * sonda niczego nie zapisuje — takze przy metodach kasujacych.
 */

/** Co sonda wie o swiecie w chwili uruchomienia — do zbudowania parametrow. */
export interface Kontekst {
  /** Wlasciciel webhooka. */
  ja: number | null;
  /** Dowolna INNA osoba z portalu — do pytania „czy widze cudze dane". */
  ktosInny: number | null;
  /** Data sprzed tygodnia, `YYYY-MM-DD` — do pytania „czy widze wstecz". */
  dawno: string;
}

export interface Sprawdzenie {
  method: string;
  /** Co konkretnie przestanie dzialac w binear, gdy tego nie ma. */
  po_co: string;
  /**
   * `false` = bez tego binear dziala, tylko ubozej. Dzieki temu panel odroznia
   * „nie wystartuje" od „nie bedzie tej jednej funkcji".
   */
  wymagane: boolean;
  /**
   * Parametry wywolania. Gdy ich NIE MA, sonda pyta tylko „czy metoda jest
   * osiagalna" (wola bez parametrow, wiec nic nie zapisuje).
   *
   * Gdy SA — pytamy o konkret i sami oceniamy odpowiedz (`ocena`). Tak
   * sprawdzamy dwie rzeczy, ktorych obecnosc metody nie rozstrzyga: czy widac
   * CUDZE dane i czy widac dane WSTECZ.
   */
  params?: (k: Kontekst) => Record<string, unknown> | null;
  /** Werdykt z tresci odpowiedzi, a nie z samego braku bledu. */
  ocena?: (wynik: unknown, k: Kontekst) => { stan: 'ok' | 'dostep' | 'brak'; opis: string };
}

export interface Grupa {
  nazwa: string;
  pozycje: Sprawdzenie[];
}

export const SPRAWDZENIA: Grupa[] = [
  {
    nazwa: 'Podstawa — bez tego binear nie ruszy',
    pozycje: [
      { method: 'tasks.task.list', po_co: 'lista zadań', wymagane: true },
      { method: 'tasks.task.get', po_co: 'szczegóły zadania', wymagane: true },
      { method: 'user.get', po_co: 'nazwiska i zdjęcia osób', wymagane: true },
      { method: 'sonet_group.user.groups', po_co: 'przełącznik projektów', wymagane: true },
    ],
  },
  {
    nazwa: 'Scrum — sprinty, etapy, story pointy',
    pozycje: [
      { method: 'tasks.api.scrum.sprint.list', po_co: 'sprinty', wymagane: false },
      { method: 'tasks.api.scrum.kanban.getStages', po_co: 'kolumny tablicy', wymagane: false },
      { method: 'tasks.api.scrum.task.get', po_co: 'story pointy i epik', wymagane: false },
      { method: 'tasks.api.scrum.epic.list', po_co: 'epiki', wymagane: false },
    ],
  },
  {
    nazwa: 'Zmiany w zadaniach',
    pozycje: [
      { method: 'tasks.task.update', po_co: 'zmiana osoby, terminu, tytułu', wymagane: false },
      { method: 'task.stages.movetask', po_co: 'przenoszenie między kolumnami', wymagane: false },
      { method: 'tasks.api.scrum.kanban.addTask', po_co: 'wejście do sprintu (nadaje IT-NNN)', wymagane: false },
      { method: 'tasks.task.delete', po_co: 'usuwanie zadań', wymagane: false },
    ],
  },
  {
    nazwa: 'Komentarze',
    pozycje: [
      { method: 'im.dialog.messages.get', po_co: 'czytanie wątku', wymagane: false },
      { method: 'task.commentitem.add', po_co: 'dodawanie komentarza', wymagane: false },
      { method: 'im.v2.Chat.Message.update', po_co: 'edycja komentarza (bez limitu czasu)', wymagane: false },
      { method: 'im.v2.Chat.Message.delete', po_co: 'usuwanie komentarza', wymagane: false },
      { method: 'im.disk.folder.get', po_co: 'załączniki — folder czatu', wymagane: false },
      { method: 'disk.folder.uploadfile', po_co: 'wklejanie zrzutów ekranu', wymagane: false },
    ],
  },
  {
    /*
     * Rozpisane DROBIAZGOWO, bo to jedyna grupa, w ktorej kazda pozycja odmawia
     * z INNEGO powodu — a od powodu zalezy, do kogo isc. Na koncie zwyklego
     * uzytkownika prawie wszystko tu swieci; sens tej listy widac dopiero po
     * uruchomieniu binear na webhooku z prawami administratora.
     */
    nazwa: 'Czas pracy i obecność',
    pozycje: [
      { method: 'timeman.status', po_co: 'własny dzień pracy (bieżący)', wymagane: false },
      {
        method: 'timeman.status',
        po_co: 'CUDZA obecność — czy widzisz dzień pracy innej osoby',
        wymagane: false,
        params: (k) => (k.ktosInny ? { USER_ID: k.ktosInny } : null),
        ocena: (w) => {
          const r = (w ?? {}) as Record<string, unknown>;
          return r.TIME_START
            ? { stan: 'ok', opis: 'tak — widać cudzą obecność' }
            : { stan: 'dostep', opis: 'nie — odpowiedź pusta, widzisz tylko siebie' };
        },
      },
      {
        method: 'timeman.status',
        po_co: 'ARCHIWUM — czy da się zapytać o miniony dzień',
        wymagane: false,
        params: (k) => (k.ja ? { USER_ID: k.ja, DATE: k.dawno } : null),
        ocena: (w, k) => {
          const start = String((w as Record<string, unknown> | null)?.TIME_START ?? '');
          if (!start) return { stan: 'brak', opis: 'brak odpowiedzi dla tamtego dnia' };
          /* Klucz: jesli oddal DZISIEJSZY wpis mimo podanej daty, znaczy ze
             parametr zignorowal — czyli archiwum nie istnieje. */
          return start.slice(0, 10) === k.dawno
            ? { stan: 'ok', opis: `tak — oddał dzień ${k.dawno}` }
            : { stan: 'brak', opis: 'nie — ignoruje datę, oddaje bieżący dzień' };
        },
      },
      { method: 'timeman.settings', po_co: 'własne reguły godzin (najpóźniejsze wejście, najwcześniejsze wyjście)', wymagane: false },
      { method: 'timeman.schedule.get', po_co: 'grafik pracy po identyfikatorze', wymagane: false },
      { method: 'timeman.record.list', po_co: 'HISTORIA obecności z filtrem po osobie i dacie — to jej brak blokuje liczenie czasu na zadaniu', wymagane: false },
      { method: 'timeman.timecontrol.reports.get', po_co: 'raport kontroli czasu pracy — treść raportu', wymagane: false },
      { method: 'timeman.timecontrol.reports.settings.get', po_co: 'czy kontrola czasu jest włączona i czy wolno Ci czytać raport', wymagane: false },
      { method: 'timeman.timecontrol.reports.users.get', po_co: 'kogo obejmuje raport kontroli czasu', wymagane: false },
      { method: 'timeman.timecontrol.settings.get', po_co: 'ustawienia narzędzia kontroli czasu', wymagane: false },
    ],
  },
  {
    nazwa: 'Struktura firmy',
    pozycje: [
      { method: 'department.get', po_co: 'grupowanie zadań po dziale', wymagane: false },
    ],
  },
];

/** Wszystkie pozycje po kolei — panel adresuje wyniki po indeksie w tej liscie. */
export const POZYCJE = SPRAWDZENIA.flatMap((g) => g.pozycje);
