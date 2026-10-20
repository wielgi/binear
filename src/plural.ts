/**
 * Polska odmiana po liczbie: 1 zadanie, 2–4 zadania (ale 12–14 zadań), 5+ zadań. Liczba razem ze slowem —
 * „1 zadań" i „22 kafelków" raza w oczy bardziej niz brak liczby.
 */
export function pl(n: number, one: string, few: string, many: string): string {
  if (n === 1) return `${n} ${one}`;
  const t = n % 10;
  const h = n % 100;
  return `${n} ${t >= 2 && t <= 4 && (h < 12 || h > 14) ? few : many}`;
}

export const zadan = (n: number): string => pl(n, 'zadanie', 'zadania', 'zadań');
export const kafelkow = (n: number): string => pl(n, 'kafelek', 'kafelki', 'kafelków');
/** 2 otwarte, 5 otwartych — przymiotnik przy liczbie zadan. */
export const otwartych = (n: number): string => pl(n, 'otwarte', 'otwarte', 'otwartych');
