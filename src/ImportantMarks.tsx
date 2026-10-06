import { BugIcon, FlameIcon } from './icons';
import { hasBugTag, isFlame } from './taskView';

/**
 * Czerwone znaki zadania WAZNEGO — na liscie (w miejscu checkboxa), na tablicy (przed tytulem) i w
 * planowaniu. Po jednym na zrodlo: plomien („Ważne" w Bitriksie, priorytet 2) i robak (tag BUG); zadanie
 * z obu dostaje oba. Wywolujacy sprawdza `isImportant`; tu tylko rysunek i podpowiedz.
 */
export function ImportantMarks({ task }: { task: { priority: string; tags: string[] } }) {
  return (
    <>
      {isFlame(task) && (
        <span className="important-mark" title="Ważne (płomień w Bitriksie)" aria-label="Ważne">
          <FlameIcon />
        </span>
      )}
      {hasBugTag(task) && (
        <span className="important-mark" title="Tag BUG" aria-label="Tag BUG">
          <BugIcon />
        </span>
      )}
    </>
  );
}
