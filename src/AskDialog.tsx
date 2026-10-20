import { useEffect, useRef } from 'react';

/** Pytanie w oknie aplikacji (jak potwierdzenia na liscie), nie `window.confirm` przegladarki. */
export interface AskState {
  title: string;
  body: string;
  /** Listy pod trescia, np. „Teraz" / „Po zmianie" z filtrami kafelka. */
  sections?: { title: string; items: string[] }[];
  /** Przyciski po „Anuluj". Fokus (czyli Enter) dostaje ostatni — chyba ze ktorys jest niszczacy, wtedy „Anuluj". */
  actions: { label: string; kind?: 'primary' | 'danger'; run: () => void }[];
}

/**
 * Dialog nad oknami (kafelki, tagi i epiki) — ten sam wyglad co potwierdzenia na liscie, tylko wyzej.
 * Esc zamyka SAM dialog: zatrzymujemy klawisz, zeby nie zamknal tez okna pod spodem.
 */
export function AskDialog({ ask, onClose }: { ask: AskState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  // Przy usuwaniu albo zastepowaniu Enter nie moze potwierdzac odruchowo — fokus na „Anuluj".
  const safe = ask.actions.some((a) => a.kind === 'danger');
  /*
   * Klawiatura na oknie, w fazie przechwytywania: Esc zamyka dialog niezaleznie od tego, gdzie jest fokus
   * (klikniecie w tresc zdejmowalo go z przyciskow i Esc zamykal okno pod spodem), a Tab krazy po przyciskach
   * dialogu — inaczej Tab + Enter trafialy w przyciski okna pod dialogiem.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const root = ref.current;
      if (!root) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
        return;
      }
      if (e.key === 'Tab') {
        const items = [...root.querySelectorAll<HTMLElement>('button:not([disabled])')];
        if (!items.length) return;
        const at = items.indexOf(document.activeElement as HTMLElement);
        const next = e.shiftKey ? (at <= 0 ? items.length - 1 : at - 1) : at === items.length - 1 ? 0 : at + 1;
        e.preventDefault();
        items[next].focus();
        return;
      }
      // Enter i reszta poza dialogiem nie moga sterowac oknem pod spodem.
      if (!root.contains(document.activeElement)) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <>
      <div className="palette-backdrop ask-backdrop" onClick={onClose} />
      <div ref={ref} tabIndex={-1} className="dialog ask-dialog" role="alertdialog" aria-modal="true" aria-label={ask.title}>
        <h2>{ask.title}</h2>
        {ask.body && <p>{ask.body}</p>}
        {ask.sections?.map((s) => (
          <div key={s.title} className="ask-section">
            <div className="ask-section-title">{s.title}</div>
            <ul>
              {s.items.map((it, i) => (
                <li key={i}>{it}</li>
              ))}
            </ul>
          </div>
        ))}
        <div className="dialog-actions">
          <button className="btn" autoFocus={safe} onClick={onClose}>
            Anuluj
          </button>
          {ask.actions.map((a, i) => (
            <button
              key={a.label}
              className={`btn${a.kind === 'danger' ? ' btn-danger' : a.kind === 'primary' ? ' btn-primary' : ''}`}
              autoFocus={!safe && i === ask.actions.length - 1}
              onClick={() => {
                onClose();
                a.run();
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
