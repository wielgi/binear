import type { MouseEvent, ReactNode } from 'react';
import { BugIcon, FlameIcon } from './icons';
import { hasBugTag, isFlame } from './taskView';

/**
 * Czerwone znaki bledu przed tytulem zadania — na liscie, tablicy i w planowaniu. Po jednym na zrodlo:
 * plomien (wysoki priorytet Bitriksa) i robak (tag BUG); zadanie z obu dostaje oba. Wywolujacy
 * sprawdza `isBug`; tu tylko rysunek i podpowiedz.
 *
 * Z `onFlame` / `onBug` znak jest klikalny i dodaje (albo zdejmuje) filtr — tak jak klik w etykiete
 * tagu. Bez nich (tablica, gdzie tagi tez nie sa klikalne) zostaje zwyklym znakiem.
 */
export function BugBadge({
  task,
  onFlame,
  onBug,
}: {
  task: { priority: string; tags: string[] };
  onFlame?: () => void;
  onBug?: () => void;
}) {
  const znak = (klasa: string, title: string, label: string, ikona: ReactNode, onPick?: () => void) =>
    onPick ? (
      <button
        type="button"
        className={`${klasa} bug-badge-btn`}
        title={`${title} — kliknij, żeby filtrować`}
        aria-label={label}
        onClick={(e: MouseEvent) => {
          e.stopPropagation();
          onPick();
        }}
      >
        {ikona}
      </button>
    ) : (
      <span className={klasa} title={title} aria-label={label}>
        {ikona}
      </span>
    );
  return (
    <>
      {isFlame(task) &&
        znak('bug-badge', 'Wysoki priorytet (płomień)', 'Wysoki priorytet', <FlameIcon />, onFlame)}
      {hasBugTag(task) && znak('bug-badge', 'Błąd — tag BUG', 'Błąd', <BugIcon />, onBug)}
    </>
  );
}
