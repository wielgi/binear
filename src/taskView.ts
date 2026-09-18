/*
 * Drobiazgi wspolne dla OBU widokow zadania — wiersza listy (App.tsx) i karty na
 * tablicy (Board.tsx). Lezą osobno, bo Board nie moze importowac z App (cykl), a
 * kazda kopia tych funkcji konczyla sie tym, ze jeden widok pokazywal cos inaczej
 * niz drugi. Zasada: co widac w wierszu, ma byc widoczne tez na karcie.
 */

export const MONTHS = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];

export function shortDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const base = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  // Rok DOPISUJEMY tylko, gdy to NIE biezacy rok. Bez tego „23 wrz" (2025) i „20 sie"
  // (2026) wygladaja jak ta sama skala, wiec poprawnie posortowana lista (po pelnym
  // znaczniku czasu) sprawia wrazenie przemieszanej na granicy lat. Biezacy rok
  // zostaje zwiezly.
  const y = d.getFullYear();
  return y === new Date().getFullYear() ? base : `${base} ${y}`;
}

/*
 * Konto-zaslepka "Nieprzypisane". Wartosc przychodzi z .env przez /api/config
 * (BX_UNASSIGNED_ID) i jest ustawiana raz, zanim wczytamy zadania — patrz
 * useBitrixData. Dlatego `let`, nie `const`: 251 to jedynie domyslka na start.
 * Import tego `let` widzi zmiane (zywe wiazanie ES), ale przypisac mozna tylko
 * przez `setUnassignedId`.
 */
export let UNASSIGNED_ID = 251;

export function setUnassignedId(id: number): void {
  if (Number.isFinite(id)) UNASSIGNED_ID = id;
}

export const UNASSIGNED_LABEL = 'Nieprzypisane';

export const isUnassigned = (responsibleId: number | null) =>
  responsibleId === null || responsibleId === UNASSIGNED_ID;

/*
 * Suma story pointow — naglowek grupy, podgrupy i kolumny tablicy pokazuje ja
 * obok liczby zadan (patrz issue #2). `null` zamiast zera, gdy ZADNE zadanie w
 * kubelku nie ma oszacowania: "0 SP" klamie, bo sugeruje oszacowane na zero,
 * a nie nieoszacowane. Zadania bez pointow po prostu nie wchodza do sumy.
 */
export function sumPoints(tasks: { storyPoints: number | null }[]): number | null {
  let sum = 0;
  let any = false;
  for (const t of tasks) {
    if (t.storyPoints == null) continue;
    sum += t.storyPoints;
    any = true;
  }
  return any ? sum : null;
}

/**
 * „zadanie / zadania / zadan" — polska liczba mnoga. Wspolna, bo licznik zadan
 * stoi w kilku miejscach (naglowki grup, kolumny, wykresy), a odmiana recznie
 * w kazdym z nich rozjezdzala sie: „2 zadan" przy osobie na wykresie.
 */
export function tasksWord(n: number): string {
  if (n === 1) return 'zadanie';
  const t = n % 10;
  const h = n % 100;
  return t >= 2 && t <= 4 && (h < 12 || h > 14) ? 'zadania' : 'zadań';
}

/**
 * Etap zadania — ale TYLKO wtedy, gdy zadanie jest w sprincie.
 *
 * Wyjecie ze sprintu NIE czysci `STAGE_ID`. Sprawdzone na IT-890 (#116305):
 * `sprintId` jest `null`, a `stageId` dalej wskazuje 4711, czyli „Nowe /
 * Oczekujace" sprintu, do ktorego zadanie juz nie nalezy. Bez tego straznika
 * zadanie z rejestru pokazuje sie w kolumnie tamtego sprintu — w grupowaniu
 * listy, w sortowaniu po etapie, w kolorze wiersza i na tablicy.
 *
 * Czytamy to jako „etap nalezy do sprintu, nie do zadania": skoro sprintu nie
 * ma, to i etapu nie ma, niezaleznie od tego, co zostalo w polu.
 */
export function stageOf(t: { sprintId: number | null; stageId: number | null }): number | null {
  return t.sprintId ? t.stageId : null;
}
