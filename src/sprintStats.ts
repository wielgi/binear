/*
 * Liczby pod wykresami sprintu — spalanie i predkosc zespolu.
 *
 * Bitrix rysuje oba wykresy u siebie, ale NIE oddaje ich przez REST: sprawdzone
 * na zywo, `tasks.api.scrum.burndown.*` i `...velocity.*` nie istnieja (404), a
 * `sprint.burndown` / `sprint.statistics` odpowiadaja bledem 22002 "Could not
 * find description of burndown in Bitrix\Tasks\Rest\Controller" — czyli kontroler
 * jest, akcji nie ma. Serie trzeba wiec zlozyc samemu z tego, co REST daje.
 *
 * Tu siedzi sama arytmetyka, bez sieci: dzieki temu da sie ja sprawdzic na
 * wymyslonych danych, a pobieranie zostaje w bitrix.ts.
 */

import type { Sprint, SprintTask, Stage } from './bitrix';

/** Jeden punkt na osi wykresu spalania. */
export interface BurndownPoint {
  /** „Planowanie", potem „Dzień 1", „Dzień 2"... — tak samo jak u Bitriksa. */
  label: string;
  /** Koniec doby, ktora ten punkt podsumowuje (punkt „Planowanie" — start sprintu). */
  at: number;
  /** Linia idealna: rowny zjazd od zaplanowanych pointow do zera. */
  ideal: number;
  /** Ile POZOSTAJE naprawde. `null` = dzien jeszcze nie nadszedl, linia sie urywa. */
  actual: number | null;
}

export interface SprintSummary {
  sprint: Sprint;
  /** Suma story pointow zadan sprintu. */
  planned: number;
  /**
   * Story pointy zrobione — STAN NA DZIS, nie tempo. Liczy wszystko, co jest juz
   * gotowe, niezaleznie od tego, czy domkniete w tym sprincie czy wczesniej.
   *
   * Wczesniej bylo tu "domkniete W OKRESIE sprintu" i to mieszalo dwa pytania:
   * `planned - completed` wychodzilo wtedy 43 SP "do zrobienia" u osoby, ktorej
   * naprawde zostalo 6 — bo 37 SP zamknieto przed startem sprintu i wpadaly one
   * do planu, ale nie do wykonania. Suma `completed + remaining` ma sie zgadzac
   * z `planned` i teraz sie zgadza.
   */
  completed: number;
  /** Story pointy, ktore NIE sa gotowe. `completed + remaining === planned`. */
  remaining: number;
  taskCount: number;
  /** Ile zadan sprintu nie ma oszacowania — bez tego „0 SP" mysli sie z „brak danych". */
  unestimated: number;
  /** SP w kolumnie "Do zatwierdzenia / PR": zamkniete, ale jeszcze nie wdrozone. */
  inReview: number;
  burndown: BurndownPoint[];
}

/*
 * LINIA IDEALNA idzie za przelacznikiem „dosypane od dnia dodania", a nie za
 * osobnym ustawieniem — bo to jedna decyzja, nie dwie.
 *
 *  wlaczone  — odniesienie liczy sie z zakresu ZNANEGO danego dnia: podnosi sie
 *              razem z dosypka i dalej schodzi do zera na koniec sprintu. Obie
 *              linie slucha wtedy tej samej zasady, co jest cala idea tego
 *              przelacznika.
 *  wylaczone — odniesienie schodzi z zakresu pierwszego dnia, tak jak dawniej.
 *
 * Dlaczego to wazne: gdy prawie cala praca doszla po starcie, zakres pierwszego
 * dnia jest ZEROWY. Stara linia lezala wtedy plasko na zerze, kazdy dzien mowil
 * „plan 0", a wskaznik tempa swiecil na czerwono mimo zrobionej roboty.
 */
const DAY = 86_400_000;

const sp = (t: SprintTask) => t.storyPoints ?? 0;

/**
 * Czy zadanie liczy sie jako zrobione.
 *
 * Wyciagniete z `summarize`, bo tej samej definicji potrzebuje takze lista osob
 * w selektorze — inaczej przelacznik "Wliczaj do zatwierdzenia" zmienialby wykres
 * i liczby nad nim, ale nie liczby przy nazwiskach tuz obok.
 */
export function taskDone(t: SprintTask, countReview: boolean): boolean {
  return countReview ? Boolean(t.closedAt) : t.done && Boolean(t.closedAt);
}

/**
 * Dni robocze sprintu. Bitrix liczy tak samo: sprint 31.08-07.09.2026 dostaje na
 * wykresie „Dzień 1".."Dzień 5", czyli poniedzialek-piatek — dzien konca nie
 * wchodzi, a weekend nie zajmuje miejsca na osi.
 */
export function workingDays(startIso: string, endIso: string): number[] {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];

  const days: number[] = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  // Bezpiecznik: sprint dluzszy niz kwartal to blad danych, nie plan.
  for (let i = 0; i < 92 && cur.getTime() < end.getTime(); i++) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) {
      // Punkt podsumowuje CALA dobe, wiec siada na jej koncu.
      days.push(new Date(cur.getFullYear(), cur.getMonth(), cur.getDate(), 23, 59, 59).getTime());
    }
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

/**
 * Spalanie jednego sprintu.
 *
 * Pointy zadania bierzemy takie, jakie sa DZIS, i stosujemy do calego sprintu —
 * bo zmiana story pointow nie trafia do dziennika zmian zadania (sprawdzone: pola
 * historii to STAGE, STATUS, TAGS, COMMENT, NEW, TITLE, DESCRIPTION,
 * MOVE_TO_SPRINT, RESPONSIBLE_ID, PARENT_ID — story pointow tam nie ma, bo leza
 * na scrumowym bycie zadania). Jesli ktos przeszacowal zadanie w trakcie sprintu,
 * wczesniejsze dni pokaza dzisiejsza wartosc. Nie da sie tego wykryc z danych,
 * wiec nie udajemy, ze umiemy — to znany limit, nie blad w liczeniu.
 */
/**
 * Moment, w ktorym zadanie „spalilo sie" — albo `null`, gdy jeszcze nie.
 *
 * Dzien spalenia zalezy od tego, CO uznajemy za zrobione. Liczac akceptacje —
 * moment oddania do niej (`reviewAt`), bo wtedy praca sie skonczyla. Liczac tylko
 * wdrozenia — `closedAt`, ktory po przejsciu do FINISH wskazuje wlasnie wdrozenie.
 * Bez tego rozroznienia zadanie oddane w sierpniu, a wdrozone we wrzesniu,
 * spadaloby z wykresu we wrzesniu w obu trybach.
 */
export function burnMoment(t: SprintTask, countReview: boolean): number | null {
  if (!t.closedAt) return null;
  if (!countReview && !t.done) return null;
  const at = new Date(countReview && t.reviewAt ? t.reviewAt : t.closedAt).getTime();
  return Number.isFinite(at) ? at : null;
}

/**
 * Czy zadanie bylo gotowe juz PRZED pierwszym dniem sprintu.
 *
 * Taka praca nie jest zakresem TEGO sprintu — nikt jej tu nie robil. Wykres
 * odejmuje ja od punktu „Planowanie" (`burnedBefore` w `buildBurndown`), wiec
 * slupek zakresu musi ja odrzucic tak samo, inaczej pokazywalby wieksza calosc
 * niz ta, ktora spala linia tuz obok.
 */
export function doneBeforeSprint(
  sprint: Sprint,
  t: SprintTask,
  countReview: boolean,
): boolean {
  if (!sprint.dateStart) return false;
  const at = burnMoment(t, countReview);
  return at !== null && at < new Date(sprint.dateStart).getTime();
}

export function buildBurndown(
  sprint: Sprint,
  tasks: SprintTask[],
  now = Date.now(),
  countReview = true,
  /** `false` = zadania dosypane w trakcie licza sie od pierwszego dnia (jak dawniej). */
  countAdded = true,
): BurndownPoint[] {
  if (!sprint.dateStart) return [];

  const planned = tasks.reduce((a, t) => a + sp(t), 0);
  const days = workingDays(sprint.dateStart, sprint.dateEnd ?? sprint.dateStart);
  if (!days.length) return [];

  /*
   * Spalaja sie tylko zadania GOTOWE (kolumna FINISH) — patrz `done` w SprintTask.
   * `closedAt` zostaje, ale juz nie jako kryterium, tylko jako MOMENT: mowi, kiedy
   * to sie stalo, i dzieki temu punkt trafia we wlasciwy dzien.
   */
  /*
   * `countReview` rozstrzyga, co znaczy "zrobione":
   *   true  - kazde zadanie z data zamkniecia, czyli TAKZE "Do zatwierdzenia / PR"
   *           (Bitrix stempluje `closedDate` juz przy statusie 4). Tak patrzy na to
   *           osoba, ktora skonczyla pisac kod i czeka na czyjas akceptacje.
   *   false - tylko kolumna FINISH, czyli to, co realnie wdrozone. Tak liczy wykres
   *           samego Bitriksa (Sprint 65: spala 68 SP z "Wdrożone", a nie 168).
   * Roznica nie jest kosmetyczna - w tym sprincie to 100 SP z 254.
   */
  const closed = tasks
    .map((t) => ({ at: burnMoment(t, countReview), points: sp(t) }))
    .filter((c): c is { at: number; points: number } => c.at !== null);

  const startAt = new Date(sprint.dateStart).getTime();

  /*
   * Punkt "Planowanie" to zakres MINUS to, co bylo gotowe juz przed startem.
   *
   * Bitrix zaczyna od pelnej sumy i nigdy nie spala zaszlosci — przez co jego
   * linia konczy sie wyzej niz faktyczna pozostalosc. U nas liczby nad wykresem
   * mowia "zostalo 86 SP", wiec linia MUSI dojsc do 86; inaczej wykres przeczy
   * podpisom tuz nad soba. Zaczynamy wiec od tego, co realnie bylo do zrobienia,
   * i spalamy wylacznie prace tego sprintu — bez sztucznego urwiska w Dniu 1,
   * ktore powstaloby, gdyby zaszlosci spalily sie naraz pierwszego dnia.
   */
  const burnedBefore = closed.reduce((a, c) => (c.at < startAt ? a + c.points : a), 0);
  const start = Math.max(0, planned - burnedBefore);

  /*
   * ZAKRES DOSYPANY W TRAKCIE. Zadanie dopisane w Dniu 3 nie bylo praca Dnia 1 —
   * doliczone od poczatku zanizalo wsteczne dni ("zrobiles mniej z wiekszej calosci",
   * chociaz tej reszty jeszcze nie bylo).
   *
   * `addedAt` bierzemy tylko wtedy, gdy wpada W OKNO tego sprintu. Znacznik z okna
   * wczesniejszego sprintu znaczy, ze zadanie weszlo do scruma dawniej i zostalo
   * przeniesione — a wtedy w TYM sprincie bylo od pierwszego dnia.
   */
  const endAt = new Date(sprint.dateEnd ?? sprint.dateStart).getTime();
  const added = countAdded
    ? tasks
        .map((t) => ({ at: t.addedAt ? new Date(t.addedAt).getTime() : NaN, points: sp(t) }))
        .filter((a) => Number.isFinite(a.at) && a.at > startAt && a.at <= endAt)
    : [];
  const addedTotal = added.reduce((a, x) => a + x.points, 0);

  /* Punkt startowy to zakres BEZ tego, co dosypano pozniej. */
  const base = Math.max(0, start - addedTotal);

  const points: BurndownPoint[] = [
    { label: 'Planowanie', at: startAt, ideal: base, actual: base },
  ];

  days.forEach((at, i) => {
    // Tylko domkniecia Z OKRESU sprintu — zaszlosci sprzed startu nie spalaja sie
    // w Dniu 1, bo nie byly praca tego sprintu (patrz punkt "Planowanie" wyzej).
    const burned = closed.reduce((a, c) => (c.at >= startAt && c.at <= at ? a + c.points : a), 0);
    points.push({
      label: `Dzień ${i + 1}`,
      at,
      /*
       * Odniesienie liczy sie z zakresu ZNANEGO na dany dzien, wiec przy
       * wlaczonym dosypywaniu linia podnosi sie razem z nim zamiast udawac, ze
       * tej pracy nie ma. Przy wylaczonym `added` jest puste i zostaje `base`.
       */
      ideal: Math.max(
        0,
        (base + added.reduce((a, x) => (x.at <= at ? a + x.points : a), 0)) *
          (1 - (i + 1) / days.length),
      ),
      // Dzien z przyszlosci nie ma stanu faktycznego — linia ma sie urwac na dzis,
      // a nie plasko biec po dzisiejszej wartosci az do konca sprintu.
      // Zakres na TEN dzien: poczatkowy plus wszystko, co dosypano do niego wlacznie.
      actual:
        at - DAY > now
          ? null
          : Math.max(0, base + added.reduce((a, x) => (x.at <= at ? a + x.points : a), 0) - burned),
    });
  });

  return points;
}

/** Jeden kawalek slupka zakresu — jedna kolumna tablicy. */
export interface ScopeSegment {
  /** Id etapu, albo `-1` dla worka na zadania bez rozpoznanej kolumny. */
  id: number;
  name: string;
  /** Kolor kolumny z Bitriksa (hex BEZ `#`), `null` = uzyj koloru zastepczego. */
  color: string | null;
  /** NEW / WORK / FINISH — po tym poznajemy, ktory kawalek znaczy „zrobione". */
  type: string;
  sp: number;
  count: number;
}

/**
 * Podzialka zakresu sprintu PER ETAP — z czego sklada sie slupek pod liczbami.
 *
 * To zdjecie STANU NA TERAZ, a nie historia: czytamy kolumne, w ktorej zadanie
 * stoi w tej chwili. I dobrze, bo historii etapow dla minionych sprintow i tak
 * nie da sie odtworzyc — przeniesienie ogona do kolejnego sprintu nie zostawia
 * wpisu w dzienniku, wiec zamkniety sprint pokazywalby same domkniete zadania.
 * Slupek ma wiec sens wylacznie dla sprintu, ktory trwa.
 *
 * Wazne: NIE zalezy od `countReview`. Ten przelacznik rozstrzyga spor „czy
 * oczekiwanie na akceptacje to juz zrobione" — a slupek go nie rozstrzyga, tylko
 * POKAZUJE, rysujac „Do zatwierdzenia" jako wlasny kawalek. Kazdy odczyta sobie
 * sam.
 *
 * Kolejnosc bierzemy z tablicy (`sort`), zeby slupek czytalo sie tak samo jak
 * kanban: od lewej „Nowe", od prawej „Wdrożone". Puste kolumny wypadaja — zerowy
 * kawalek i tak nic nie rysuje, a w legendzie bylby samym szumem.
 */
export function stageBreakdown(tasks: SprintTask[], stages: Stage[]): ScopeSegment[] {
  const order = [...stages].sort((a, b) => a.sort - b.sort);
  const seg = new Map<number, ScopeSegment>(
    order.map((st) => [st.id, { id: st.id, name: st.name, color: st.color, type: st.type, sp: 0, count: 0 }]),
  );

  /*
   * Worek na zadania, ktorych kolumny nie ma w komplecie tego sprintu. Nie
   * powinno go byc, ale gdyby Bitrix oddal etap spoza sprintu, to lepiej zeby
   * slupek byl o kawalek dluzszy niz zeby po cichu zgubil czyjas prace.
   */
  const OTHER = -1;

  for (const t of tasks) {
    const key = t.stageId !== null && seg.has(t.stageId) ? t.stageId : OTHER;
    const cur =
      seg.get(key) ??
      { id: OTHER, name: 'Poza tablicą', color: null, type: '', sp: 0, count: 0 };
    cur.sp += sp(t);
    cur.count += 1;
    seg.set(key, cur);
  }

  return [...seg.values()].filter((x) => x.sp > 0);
}

/** Zwiniecie sprintu do jednego slupka wykresu predkosci. */
export function summarize(
  sprint: Sprint,
  tasks: SprintTask[],
  now = Date.now(),
  countReview = true,
  countAdded = true,
): SprintSummary {
  /*
   * ZAKRES TEGO SPRINTU: zadania sprintu MINUS to, co bylo gotowe juz przed jego
   * pierwszym dniem. Tamtej pracy nikt tutaj nie wykonal — przyszla domknieta —
   * wiec nie jest ani "do zrobienia", ani "zrobione w tym sprincie".
   *
   * Wszystkie liczby w SP licza sie z tego jednego zbioru i dlatego sie zgadzaja:
   * zaplanowane - zakonczone = zostalo. Wczesniej "Zaplanowane" odejmowalo
   * zaszlosci, a "Zakonczone" je doliczalo, wiec karta twierdzila naraz "121
   * zaplanowane, 107 zrobione" i "89 zostalo" — trzy liczby, ktore nie moga byc
   * prawdziwe jednoczesnie.
   *
   * To ten sam zbior, na ktorym stoi wykres (punkt "Planowanie" = jego suma)
   * i slupek zakresu. Trzy elementy karty, jedna definicja.
   */
  const scoped = tasks.filter((t) => !doneBeforeSprint(sprint, t, countReview));

  const planned = scoped.reduce((a, t) => a + sp(t), 0);

  /*
   * "Gotowe" zalezy od `countReview`: przy wlaczonym liczy sie kazde zadanie
   * z data zamkniecia (czyli takze "Do zatwierdzenia / PR"), przy wylaczonym
   * tylko kolumna FINISH.
   */
  const isDone = (t: SprintTask) => taskDone(t, countReview);
  const completed = scoped.reduce((a, t) => (isDone(t) ? a + sp(t) : a), 0);
  const remaining = scoped.reduce((a, t) => (isDone(t) ? a : a + sp(t)), 0);

  const burndown = buildBurndown(sprint, tasks, now, countReview, countAdded);

  return {
    sprint,
    planned,
    completed,
    remaining,
    /*
     * LICZBY ZADAN tez ze zwezonego zakresu — jak wszystko na tej karcie.
     *
     * Probowalem inaczej: brac je z pelnej listy sprintu, zeby zgadzaly sie
     * z liczba wierszy na liscie. Ale tabela osob pod wykresem liczy zadania
     * TEJ SAMEJ osoby ze zwezonego zakresu, wiec po zaznaczeniu kogos naglowek
     * mowil "19 zadań", a jego wlasny wiersz tuz pod nim "6 zadań". Dwie liczby
     * o tej samej nazwie na jednym ekranie.
     *
     * Karta odpowiada na pytanie "z czego sklada sie praca tego sprintu", wiec
     * zadanie gotowe przed jego startem nie nalezy tu tak samo, jak nie naleza
     * jego story pointy. Lista odpowiada na inne pytanie ("co jest w sprincie")
     * i dlatego pokazuje wiecej — podpowiedz przy liczbie to mowi.
     */
    taskCount: scoped.length,
    unestimated: scoped.filter((t) => t.storyPoints === null).length,
    inReview: scoped.reduce((a, t) => (t.closedAt && !t.done ? a + sp(t) : a), 0),
    burndown,
  };
}
