import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Karta pod kursorem — wspolny odczyt dla drobnych plakietek w wierszach,
 * naglowkach i na kartach tablicy.
 *
 * Uklad i typografia sa wziete z odczytu na wykresie spalania przy kilku osobach:
 * na gorze przygaszony PODPIS („co to jest"), pod nim wyrazna WARTOSC i obok niej
 * przygaszony DOPISEK. Dzieki temu obie karty w aplikacji czytaja sie tak samo.
 *
 * Zamiast `title`, czyli podpowiedzi przegladarki, bo ta pojawia sie z sekundowym
 * opoznieniem i jest jednym ciagiem tekstu — nie da sie w niej odroznic opisu od
 * odpowiedzi.
 *
 * Renderowana przez PORTAL: listy i panele przewijaja sie w kontenerach z
 * `overflow`, wiec karta pozycjonowana w srodku wiersza bylaby przycieta przy
 * gornej krawedzi. Stoi NAD elementem i jest dociskana do jego prawej krawedzi.
 */
export function HoverNote({
  label,
  value,
  note,
  noteColor,
  className,
  children,
}: {
  /** Przygaszony podpis nad wartoscia — „Termin", „Story points", „Zadania". */
  label: string;
  /** To, po co sie tu zaglada. */
  value: ReactNode;
  /** Dopisek obok wartosci; to on zwykle niesie kolor. */
  note?: ReactNode;
  /** Kolor dopisku — dowolna wartosc CSS, zwykle wyliczona (patrz `dueFill`). */
  noteColor?: string;
  className?: string;
  children: ReactNode;
}) {
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);

  return (
    <span
      className={className}
      onMouseEnter={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setAt({ top: r.top, right: window.innerWidth - r.right });
      }}
      onMouseLeave={() => setAt(null)}
    >
      {children}
      {at &&
        createPortal(
          <div className="due-card" style={{ top: at.top, right: at.right }} role="tooltip">
            <div className="due-card-label">{label}</div>
            <div className="due-card-row">
              <span className="due-card-value">{value}</span>
              {note !== undefined && note !== '' && (
                <span className="due-card-note" style={noteColor ? { color: noteColor } : undefined}>
                  {note}
                </span>
              )}
            </div>
          </div>,
          document.body,
        )}
    </span>
  );
}
