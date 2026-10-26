import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type SettingsTab = 'tiles' | 'look' | 'env' | 'team' | 'manage' | 'perms';

export const SETTINGS_TABS: { key: SettingsTab; label: string; hint: string }[] = [
  { key: 'look', label: 'Wygląd', hint: 'Motyw, czcionka, panel zadania, karta zadania na liście' },
  { key: 'tiles', label: 'Kafelki', hint: 'Grupy, kolejność, kolory; tylko w tej przeglądarce' },
  { key: 'env', label: 'Środowisko', hint: 'Projekt domyślny, działy i konta IT, moc bez zespołu' },
  { key: 'team', label: 'Zespół i grafik', hint: 'Role, etaty, budżet SP, urlopy' },
  { key: 'manage', label: 'Tagi i epiki', hint: 'Zmiana nazwy, scalanie, usuwanie' },
  { key: 'perms', label: 'Uprawnienia webhooka', hint: 'Co ten token potrafi' },
];

/**
 * Jedno okno na cala konfiguracje: zakladki po lewej, tresc po prawej. Zakladka raz otwarta zostaje zamontowana
 * (tylko schowana), zeby przelaczenie nie gubilo niezapisanego formularza, wybranego tygodnia ani wyniku sprawdzania.
 * `locked` (zapis tagow i epikow w toku) blokuje zamkniecie i przelaczanie — inaczej postep i blad znikalyby z oczu.
 */
export function SettingsModal({
  tab,
  locked,
  unsaved,
  onTab,
  onClose,
  panes,
}: {
  tab: SettingsTab;
  locked: boolean;
  /** Zakladki z niezapisanymi zmianami — kropka przy nazwie (zamkniecie okna o nie zapyta, patrz App). */
  unsaved: ReadonlySet<SettingsTab>;
  onTab: (tab: SettingsTab) => void;
  onClose: () => void;
  panes: Record<SettingsTab, () => ReactNode>;
}) {
  const [visited, setVisited] = useState<ReadonlySet<SettingsTab>>(() => new Set([tab]));
  useEffect(() => setVisited((v) => (v.has(tab) ? v : new Set([...v, tab]))), [tab]);

  /*
   * Esc, ktory zalatwil juz ktos blizej (pole szukania, picker, pole zmiany nazwy), okna nie zamyka. Kafelki maja
   * wlasna klawiature (pierwszy Esc odznacza kafelek, drugi zamyka okno), wiec tam Esc zostawiamy im.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || locked || tab === 'tiles') return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [locked, onClose, tab]);

  const current = SETTINGS_TABS.find((t) => t.key === tab) ?? SETTINGS_TABS[0];
  return createPortal(
    <>
      <div className="picker-backdrop modal-scrim" onClick={(e) => !locked && e.detail < 2 && onClose()} />
      <div className="team-modal settings-modal" role="dialog" aria-label="Ustawienia">
        <nav className="settings-nav" role="tablist" aria-orientation="vertical">
          <h2>Ustawienia</h2>
          {SETTINGS_TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={t.key === tab}
              className={`settings-tab${t.key === tab ? ' settings-tab-on' : ''}`}
              disabled={locked && t.key !== tab}
              onClick={() => onTab(t.key)}
            >
              <span className="settings-tab-label">
                {t.label}
                {unsaved.has(t.key) && <span className="settings-tab-dot" title="Niezapisane zmiany" />}
              </span>
              <span className="settings-tab-hint">{t.hint}</span>
            </button>
          ))}
        </nav>
        <section className="settings-body">
          <header className="team-head">
            <h2>{current.label}</h2>
            <button className="btn" onClick={onClose} disabled={locked}>
              Zamknij
            </button>
          </header>
          {SETTINGS_TABS.filter((t) => visited.has(t.key)).map((t) => (
            <div key={t.key} className={`settings-pane settings-pane-${t.key}`} role="tabpanel" hidden={t.key !== tab}>
              {panes[t.key]()}
            </div>
          ))}
        </section>
      </div>
    </>,
    document.body,
  );
}
