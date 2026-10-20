import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { AskDialog, type AskState } from './AskDialog';
import { kafelkow, pl } from './plural';

import {
  addGroup,
  addTile,
  DEFAULT_COLOR,
  DEFAULT_ICON,
  ensureLooseGroup,
  exportConfig,
  groupedTiles,
  importConfig,
  emptyConfig,
  fetchDefaultTiles,
  isHexColor,
  moveGroup,
  moveTile,
  moveToGroup,
  newId,
  placeTile,
  detachTile,
  removeGroup,
  removeTile,
  renameGroup,
  setGroupCaption,
  TILE_COLORS,
  TILE_ICON_PICKER,
  updateTile,
  type CustomTile,
  type TileCondition,
  type TileGroup,
  type TileMeasure,
  type TileScope,
  type TilesConfig,
} from './customTiles';
import { PlusIcon } from './tileIcons';
import { TILE_ICON_NODES, tileColorCss } from './TilesBar';

/** Widok z listy (zakres, filtry, przelaczniki) — to, co zapisuje sie w kafelku. */
export interface TileView {
  scope: TileScope;
  filters: TileCondition[];
  onlyMine: boolean;
  showDone: boolean;
}

const SCOPE_LABEL: Record<TileScope, string> = { sprint: 'aktywny sprint', outside: 'poza sprintem', all: 'wszystkie' };

const describeView = (v: TileView): string => {
  const n = v.filters.filter((c) => c.values.length).length;
  return [
    `zakres: ${SCOPE_LABEL[v.scope]}`,
    pl(n, 'filtr', 'filtry', 'filtrów'),
    v.onlyMine ? 'tylko moje' : null,
    v.showDone ? 'z zakończonymi' : null,
  ]
    .filter(Boolean)
    .join(' · ');
};

function Swatches({ value, onPick }: { value: string; onPick: (k: string) => void }) {
  return (
    <span className="tile-swatches">
      {Object.entries(TILE_COLORS).map(([k, c]) => (
        <button
          key={k}
          type="button"
          className={`tile-swatch${value === k ? ' tile-swatch-on' : ''}`}
          style={{ background: c.css }}
          title={c.label}
          aria-label={c.label}
          aria-pressed={value === k}
          onClick={() => onPick(k)}
        />
      ))}
      {/* Dowolny kolor: pelny picker przegladarki; wybrany kolor zapisuje sie jako #rrggbb. */}
      <label
        className={`tile-swatch tile-swatch-custom${isHexColor(value) ? ' tile-swatch-on' : ''}`}
        title="Własny kolor"
        style={isHexColor(value) ? { background: value } : undefined}
      >
        {!isHexColor(value) && <span className="tile-swatch-plus" aria-hidden>+</span>}
        <input
          type="color"
          value={isHexColor(value) ? value : '#58a6ff'}
          aria-label="Własny kolor"
          onChange={(e) => onPick(e.target.value)}
        />
      </label>
    </span>
  );
}

/**
 * Wybor ikony: w formularzu jeden kwadrat z biezaca ikona w kolorze kafelka, a cala siatka dopiero po
 * kliknieciu — 56 ikon na stale zajmowalo pol okna i przytlaczalo reszte formularza.
 */
function Icons({ value, color, onPick }: { value: string; color: string; onPick: (k: string) => void }) {
  /* Pozycja okienka liczona z przycisku: okno kafelkow przewija sie i przycina tresc (overflow), wiec okienko
     idzie portalem do <body> i staje pod przyciskiem albo — gdy brakuje miejsca — nad nim. */
  const [open, setOpen] = useState<{ left: number; top: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const toggle = () => {
    if (open) return setOpen(null);
    const r = trigger.current?.getBoundingClientRect();
    if (!r) return;
    const h = 6 * 34 + 12; // szesc rzedow ikon + margines
    const top = r.bottom + 4 + h > window.innerHeight ? Math.max(8, r.top - 4 - h) : r.bottom + 4;
    setOpen({ left: r.left, top });
  };
  /* Esc zamyka SAMO okienko ikon. Lapiemy go w fazie przechwytywania na oknie, zanim dojdzie do klawiatury
     edytora kafelkow (ta zdjelaby zaznaczenie kafelka albo zamknela cale okno). Pozostale skroty edytora
     (strzalki, Delete, N) tez tu koncza — inaczej strzalka wybierala inny kafelek, a otwarte okienko
     zmienialo potem jego ikone. Tab, Enter i spacja zostaja dla przyciskow ikon. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') {
        if (/^(Arrow|Delete$|Backspace$|n$|N$)/.test(e.key)) e.stopImmediatePropagation();
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      setOpen(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);
  return (
    <span className="tile-icon-wrap" style={{ ['--c' as string]: tileColorCss(color) } as CSSProperties}>
      <button
        ref={trigger}
        type="button"
        className="tile-icon-current"
        aria-haspopup="listbox"
        aria-expanded={Boolean(open)}
        title="Zmień ikonę"
        onClick={toggle}
      >
        <span className="counter-icon">{TILE_ICON_NODES[value] ?? TILE_ICON_NODES.list}</span>
        <span className="tile-icon-change">Zmień</span>
      </button>
      {open &&
        createPortal(
        <>
          <div className="tile-icon-backdrop" onClick={() => setOpen(null)} />
          <span
            className="tile-icon-pop"
            role="listbox"
            aria-label="Ikony"
            style={{ left: open.left, top: open.top, ['--c' as string]: tileColorCss(color) } as CSSProperties}
          >
            {TILE_ICON_PICKER.map((k) => (
              <button
                key={k}
                type="button"
                role="option"
                className={`tile-icon-btn${value === k ? ' tile-icon-on' : ''}`}
                title={k}
                aria-label={`Ikona ${k}`}
                aria-selected={value === k}
                autoFocus={value === k}
                onClick={() => {
                  onPick(k);
                  setOpen(null);
                }}
              >
                {TILE_ICON_NODES[k]}
              </button>
            ))}
          </span>
        </>,
          document.body,
        )}
    </span>
  );
}

/** Wiersz formularza jak w panelu widoku: etykieta po lewej, kontrolka po prawej. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="tile-field">
      <span className="tile-field-label">{label}</span>
      <div className="tile-field-ctl">{children}</div>
    </div>
  );
}

/** Wybor jednej z kilku opcji — te same segmenty co zakres listy. */
function Segments({ value, options, onPick }: { value: string; options: { value: string; label: string }[]; onPick: (v: string) => void }) {
  return (
    <span className="segments tile-segments">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`segment${o.value === value ? ' segment-active' : ''}`}
          aria-pressed={o.value === value}
          onClick={() => onPick(o.value)}
        >
          {o.label}
        </button>
      ))}
    </span>
  );
}

const MEASURES = [
  { value: 'count', label: 'Liczba zadań' },
  { value: 'points', label: 'Suma SP' },
];

/**
 * Zarzadzanie wlasnymi kafelkami: nowy kafelek z biezacego widoku, nazwy, kolory, ikony, grupy,
 * kolejnosc, zestaw „proces IT", eksport i import pliku JSON (dzieki temu dzial moze wyslac swoj zestaw).
 */
const LOOSE = '__loose';
/* Cel upuszczenia „poza grupe": kafelek dostaje wlasna grupe bez podpisu (`detachTile`). */
const OUT = '__out';

/** Co jest zaznaczone w pasku kafelkow: kafelek, grupa albo formularz nowego kafelka. */
type Sel = { k: 'tile'; id: string } | { k: 'group'; id: string } | { k: 'new' } | null;

export function TilesModal({
  cfg,
  current,
  startNew,
  views,
  onSaveAsView,
  describeFilter,
  onChange,
  onClose,
}: {
  cfg: TilesConfig;
  /** Widok na liscie w tej chwili — z niego powstaje nowy kafelek albo nim zastepujemy stary. */
  current: TileView;
  /** Otwarte przyciskiem „＋ Kafelek": od razu formularz nowego kafelka. */
  startNew: boolean;
  /** Zapisane widoki — kafelek moze powstac z kazdego z nich, nie tylko z biezacego. */
  views: { id: string; name: string; view: TileView }[];
  /** Kafelek → zapisany widok (z biezacym grupowaniem i sortowaniem, zakres i filtry z kafelka). */
  onSaveAsView: (name: string, view: TileView) => void;
  /** Warunek po ludzku, jak na chipie paska filtrow („Tag dowolny z BUG"). */
  describeFilter: (c: TileCondition) => string;
  onChange: (next: TilesConfig) => void;
  onClose: () => void;
}) {
  const [sel, setSel] = useState<Sel>(startNew ? { k: 'new' } : null);
  const [name, setName] = useState('');
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [icon, setIcon] = useState(DEFAULT_ICON);
  const [measure, setMeasure] = useState<TileMeasure>('count');
  const [groupId, setGroupId] = useState(cfg.groups[0]?.id ?? '');
  const [newGroup, setNewGroup] = useState('');
  const [importMsg, setImportMsg] = useState<string | null>(null);
  /** Skad nowy kafelek bierze filtry: '' = biezacy widok, inaczej id zapisanego widoku. */
  const [source, setSource] = useState('');
  const sourceView = views.find((v) => v.id === source)?.view ?? current;
  /*
   * Przeciaganie kafelkow w pasku: natywny HTML5 drag&drop, jak przestawianie widokow w menu widokow.
   * `drop` to miejsce upuszczenia: przed kafelkiem `before` albo (null) na koncu grupy `group`.
   */
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ group: string; before: string | null } | null>(null);
  const endDrag = () => {
    setDragId(null);
    setDrop(null);
  };
  const aim = (group: string, before: string | null) => {
    if (drop?.group !== group || drop.before !== before) setDrop({ group, before });
  };
  const land = () => {
    if (dragId && drop) onChange(drop.group === OUT ? detachTile(cfg, dragId) : placeTile(cfg, dragId, drop.group, drop.before));
    endDrag();
  };
  const fileRef = useRef<HTMLInputElement>(null);
  // Wybrana grupa mogla zniknac (usunieta, „Wyczysc wszystko") — wtedy pierwsza istniejaca.
  const pickedGroup = groupId === LOOSE || cfg.groups.some((g) => g.id === groupId) ? groupId : (cfg.groups[0]?.id ?? LOOSE);

  const create = () => {
    if (!name.trim()) return;
    let next = cfg;
    let g = pickedGroup;
    if (g === LOOSE && !newGroup.trim()) {
      const loose = ensureLooseGroup(next);
      next = loose.cfg;
      g = loose.id;
    } else if (newGroup.trim() || !cfg.groups.length) {
      next = addGroup(next, newGroup.trim() || 'Moje kafelki');
      g = next.groups[next.groups.length - 1].id;
    }
    const id = newId('t');
    next = addTile(next, { id, name: name.trim().slice(0, 40), ...sourceView, measure, color, icon, group: g });
    onChange(next);
    setName('');
    setNewGroup('');
    setSource('');
    setSel({ k: 'tile', id });
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([exportConfig(cfg)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'binear-kafelki.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  /*
   * Import (z pliku albo domyslny zestaw). Przy istniejacych kafelkach najpierw pytanie: zastapic je
   * czy dolozyc — dolozenie drugi raz tego samego zestawu dalby duplikaty, a zastapienie kasuje wlasne.
   */
  const [ask, setAsk] = useState<AskState | null>(null);
  const applyImport = (text: string, mode: 'replace' | 'append') => {
    const base = mode === 'replace' ? emptyConfig() : cfg;
    const next = importConfig(text, base);
    if (!next) return setImportMsg('To nie jest plik kafelków binear albo nie ma w nim kafelków.');
    onChange(next);
    setSel(null);
    const n = next.tiles.length - base.tiles.length;
    setImportMsg(mode === 'replace' ? `Zastąpiono kafelki nowymi (${n}).` : `Dołożono kafelki (${n}).`);
  };
  const startImport = (text: string | null, source: 'file' | 'defaults' = 'file') => {
    setImportMsg(null);
    if (text === null) return setImportMsg('Nie udało się wczytać domyślnych kafelków.');
    const probe = importConfig(text, emptyConfig());
    if (!probe) return setImportMsg('To nie jest plik kafelków binear albo nie ma w nim kafelków.');
    if (!cfg.tiles.length) return applyImport(text, 'append');
    setAsk({
      title: 'Zastąpić obecne kafelki czy dołożyć nowe?',
      body: `${source === 'defaults' ? 'Domyślny zestaw' : 'Plik'} ma ${kafelkow(probe.tiles.length)}, a masz już ${cfg.tiles.length}. Zastąpienie usuwa obecne razem z ich historią; dołożenie drugi raz tego samego zestawu da duplikaty.`,
      actions: [
        { label: 'Zastąp', kind: 'danger', run: () => applyImport(text, 'replace') },
        { label: 'Dołóż', kind: 'primary', run: () => applyImport(text, 'append') },
      ],
    });
  };
  const onFile = async (file: File | undefined) => {
    if (file) startImport(await file.text());
  };
  const loadDefaults = async () => startImport(await fetchDefaultTiles(), 'defaults');

  /** Usuwa wszystkie kafelki i grupy — po pytaniu; eksport przed tym to jedyna kopia. */
  const clearAll = () =>
    setAsk({
      title: 'Wyczyścić wszystkie kafelki?',
      body: `Usunie kafelki (${cfg.tiles.length}) i grupy (${cfg.groups.length}). Jeśli chcesz je zachować, najpierw wyeksportuj do pliku.`,
      actions: [
        {
          label: 'Wyczyść',
          kind: 'danger',
          run: () => {
            onChange(emptyConfig());
            setSel(null);
            setImportMsg('Usunięto wszystkie kafelki.');
          },
        },
      ],
    });

  /** Zakres, filtry (LUB zaznaczone) i przelaczniki widoku — do pytania o nadpisanie. */
  const viewLines = (v: TileView): string[] => {
    const conds = v.filters.filter((c) => c.values.length);
    return [
      `Zakres: ${SCOPE_LABEL[v.scope]}`,
      ...conds.map((c, i) => (c.or && conds.slice(0, i).some((x) => x.or === c.or) ? `lub ${describeFilter(c)}` : describeFilter(c))),
      ...(conds.length ? [] : ['Bez filtrów']),
      ...(v.onlyMine ? ['Tylko moje'] : []),
      ...(v.showDone ? ['Z zakończonymi'] : []),
    ];
  };

  const selTile = sel?.k === 'tile' ? cfg.tiles.find((t) => t.id === sel.id) : undefined;
  const selGroup = sel?.k === 'group' ? cfg.groups.find((g) => g.id === sel.id) : undefined;

  /** Usuwa zaznaczony kafelek albo grupe — po pytaniu, bo Delete z klawiatury latwo wcisnac przypadkiem. */
  const removeSelected = () => {
    if (selTile) {
      const t = selTile;
      setAsk({
        title: `Usunąć kafelek „${t.name}"?`,
        body: 'Razem z kafelkiem znika jego historia (strzałki dzień do dnia).',
        actions: [{ label: 'Usuń', kind: 'danger', run: () => (onChange(removeTile(cfg, t.id)), setSel(null)) }],
      });
    } else if (selGroup) {
      const g = selGroup;
      const n = cfg.tiles.filter((t) => t.group === g.id).length;
      setAsk({
        title: `Usunąć grupę „${g.name}"?`,
        body: n ? `Razem z nią znikną jej kafelki (${n}).` : 'Grupa jest pusta.',
        actions: [{ label: 'Usuń grupę', kind: 'danger', run: () => (onChange(removeGroup(cfg, g.id)), setSel(null)) }],
      });
    }
  };

  /*
   * Klawiatura (poza polami tekstowymi): ←/→ wybiera sasiedni kafelek (albo grupe), Shift+←/→ przesuwa
   * zaznaczony, ↑ przechodzi z kafelka na jego grupe, ↓ z grupy na jej pierwszy kafelek, Delete usuwa,
   * N otwiera nowy kafelek, Esc zdejmuje zaznaczenie, a drugi Esc zamyka okno. Globalne skroty listy
   * sa w tym czasie wylaczone (App nie reaguje, gdy okno kafelkow jest otwarte).
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Otwarte pytanie: Esc je zamyka, reszte klawiszy (Enter, Tab) obsluguja jego przyciski.
      if (ask) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setAsk(null);
        }
        return;
      }
      const el = e.target instanceof HTMLElement ? e.target : null;
      const field = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
      if (e.key === 'Escape') {
        e.preventDefault();
        if (field) el.blur();
        else if (sel) setSel(null);
        else onClose();
        return;
      }
      if (field || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const d = e.key === 'ArrowLeft' ? -1 : 1;
        if (e.shiftKey) {
          if (selTile) onChange(moveTile(cfg, selTile.id, d));
          else if (selGroup) onChange(moveGroup(cfg, selGroup.id, d));
          return;
        }
        if (selGroup) {
          const g = cfg.groups[cfg.groups.findIndex((x) => x.id === selGroup.id) + d];
          if (g) setSel({ k: 'group', id: g.id });
          return;
        }
        const flat = groupedTiles(cfg).flatMap((g) => g.tiles);
        const next = selTile ? flat[flat.findIndex((x) => x.id === selTile.id) + d] : flat[d === 1 ? 0 : flat.length - 1];
        if (next) setSel({ k: 'tile', id: next.id });
      } else if (e.key === 'ArrowUp' && selTile) {
        e.preventDefault();
        setSel({ k: 'group', id: selTile.group });
      } else if (e.key === 'ArrowDown' && selGroup) {
        e.preventDefault();
        const first = cfg.tiles.find((x) => x.group === selGroup.id);
        if (first) setSel({ k: 'tile', id: first.id });
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && (selTile || selGroup)) {
        e.preventDefault();
        removeSelected();
      } else if (e.key.toLowerCase() === 'n' && !e.shiftKey) {
        e.preventDefault();
        setSel({ k: 'new' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /* Grupy bez podpisu nazywamy po pierwszym kafelku — kilka „Bez podpisu" obok siebie nie dawalo sie odroznic. */
  const groupOptions = cfg.groups.map((g) => {
    if (!g.hideCaption) return { value: g.id, label: g.name };
    const first = cfg.tiles.find((t) => t.group === g.id)?.name;
    return { value: g.id, label: first ? `Bez podpisu (${first})` : 'Bez podpisu' };
  });

  const newForm = (
    <section className="tile-form">
      <header className="tile-form-head">
        <h3>Nowy kafelek</h3>
        <span className="tile-form-sub">{describeView(sourceView)}</span>
        <span className="tile-form-tools tile-form-actions">
          <button className="btn" onClick={() => setSel(null)}>
            Anuluj
          </button>
          <button className="btn btn-primary" disabled={!name.trim()} onClick={create}>
            Dodaj kafelek
          </button>
        </span>
      </header>
      {views.length > 0 && (
        <Field label="Z widoku">
          <Segments
            value={source}
            options={[{ value: '', label: 'Bieżący' }, ...views.map((v) => ({ value: v.id, label: v.name }))]}
            onPick={(v) => {
              // Nazwa podpowiada sie z widoku, dopoki nie wpisano wlasnej.
              const prev = views.find((x) => x.id === source)?.name ?? '';
              const next = views.find((x) => x.id === v)?.name ?? '';
              if (!name.trim() || name === prev) setName(next);
              setSource(v);
            }}
          />
        </Field>
      )}
      <Field label="Nazwa">
        <input
          className="picker-input tile-name"
          placeholder="Nazwa kafelka"
          value={name}
          maxLength={40}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && create()}
        />
      </Field>
      <Field label="Kolor">
        <Swatches value={color} onPick={setColor} />
      </Field>
      <Field label="Ikona">
        <Icons value={icon} color={color} onPick={setIcon} />
      </Field>
      <Field label="Liczy">
        <Segments value={measure} options={MEASURES} onPick={(v) => setMeasure(v as TileMeasure)} />
      </Field>
      <Field label="Grupa">
        <Segments
          value={pickedGroup}
          options={[...groupOptions, { value: LOOSE, label: 'Osobno' }]}
          onPick={(v) => {
            setGroupId(v);
            setNewGroup('');
          }}
        />
        <input
          className="picker-input tile-new-group"
          placeholder={cfg.groups.length ? 'albo nowa grupa' : 'nazwa grupy'}
          value={newGroup}
          maxLength={40}
          onChange={(e) => setNewGroup(e.target.value)}
        />
      </Field>
    </section>
  );

  /** Naglowek edytora: nazwa elementu, przesuwanie strzalkami (tez Shift+←/→) i usuwanie. */
  const head = (title: string, onMove: (dir: -1 | 1) => void, onRemove: () => void, removeLabel: string) => (
    <header className="tile-form-head">
      <h3>{title}</h3>
      <span className="tile-form-tools">
        <button className="tile-tool" onClick={() => onMove(-1)} title="Przesuń w lewo (Shift+←)" aria-label="Przesuń w lewo">
          ←
        </button>
        <button className="tile-tool" onClick={() => onMove(1)} title="Przesuń w prawo (Shift+→)" aria-label="Przesuń w prawo">
          →
        </button>
        <button className="tile-tool tile-tool-danger" onClick={onRemove} title={`${removeLabel} (Delete)`}>
          {removeLabel}
        </button>
      </span>
    </header>
  );

  const tileEditor = (t: CustomTile) => (
    <section className="tile-form">
      {head('Kafelek', (d) => onChange(moveTile(cfg, t.id, d)), () => removeSelected(), 'Usuń')}
      <Field label="Nazwa">
        <input
          className="picker-input tile-name"
          value={t.name}
          maxLength={40}
          aria-label="Nazwa kafelka"
          onChange={(e) => onChange(updateTile(cfg, t.id, { name: e.target.value }))}
          onBlur={(e) => !e.target.value.trim() && onChange(updateTile(cfg, t.id, { name: 'Kafelek' }))}
        />
      </Field>
      <Field label="Kolor">
        <Swatches value={t.color} onPick={(k) => onChange(updateTile(cfg, t.id, { color: k }))} />
      </Field>
      <Field label="Ikona">
        <Icons value={t.icon} color={t.color} onPick={(k) => onChange(updateTile(cfg, t.id, { icon: k }))} />
      </Field>
      <Field label="Liczy">
        <Segments value={t.measure} options={MEASURES} onPick={(v) => onChange(updateTile(cfg, t.id, { measure: v as TileMeasure }))} />
      </Field>
      <Field label="Grupa">
        <Segments
          value={t.group}
          options={[...groupOptions, { value: LOOSE, label: 'Osobno' }]}
          onPick={(v) => onChange(v === LOOSE ? detachTile(cfg, t.id) : moveToGroup(cfg, t.id, v))}
        />
      </Field>
      <Field label="Filtry">
        <span className="tile-form-sub">{describeView(t)}</span>
        <button
          className="btn"
          onClick={() =>
            setAsk({
              title: `Nadpisać filtry kafelka „${t.name}”?`,
              body: 'Kafelek dostanie filtry bieżącego widoku z listy. Poprzednich nie da się przywrócić.',
              sections: [
                { title: 'Teraz', items: viewLines(t) },
                { title: 'Po zmianie', items: viewLines(current) },
              ],
              actions: [{ label: 'Nadpisz', kind: 'danger', run: () => onChange(updateTile(cfg, t.id, { ...current })) }],
            })
          }
          title={`Zastąp filtry kafelka bieżącym widokiem (${describeView(current)})`}
        >
          Użyj bieżącego widoku
        </button>
        <button
          className="btn"
          onClick={() => {
            onSaveAsView(t.name, { scope: t.scope, filters: t.filters, onlyMine: t.onlyMine, showDone: t.showDone });
            setImportMsg(`Zapisano widok „${t.name}" — jest w menu Widoki (V).`);
          }}
          title="Zapisz zakres i filtry kafelka jako widok (menu Widoki, skrót V)"
        >
          Zapisz jako widok
        </button>
      </Field>
    </section>
  );

  const groupEditor = (g: TileGroup) => (
    <section className="tile-form">
      {head('Grupa', (d) => onChange(moveGroup(cfg, g.id, d)), () => removeSelected(), 'Usuń grupę')}
      <Field label="Nazwa">
        <input
          className="picker-input tile-name"
          value={g.name}
          maxLength={40}
          aria-label="Nazwa grupy"
          onChange={(e) => onChange({ ...cfg, groups: cfg.groups.map((x) => (x.id === g.id ? { ...x, name: e.target.value } : x)) })}
          onBlur={(e) => onChange(renameGroup(cfg, g.id, e.target.value.trim() || 'Grupa'))}
        />
      </Field>
      <Field label="Podpis">
        <Segments
          value={g.hideCaption ? 'off' : 'on'}
          options={[
            { value: 'on', label: 'Nazwa i suma' },
            { value: 'off', label: 'Bez podpisu' },
          ]}
          onPick={(v) => onChange(setGroupCaption(cfg, g.id, v === 'on'))}
        />
      </Field>
    </section>
  );

  /** Pasek jak na liście: grupy z podpisem i kafelki; klik zaznacza element do edycji, plus dodaje nowy. */
  const strip = (
    <div className="counters tiles-strip" role="toolbar" aria-label="Kafelki do edycji">
      {cfg.groups.map((g) => (
        <div
          key={g.id}
          className="counters-group"
          style={{ ['--n' as string]: Math.max(1, cfg.tiles.filter((t) => t.group === g.id).length) } as CSSProperties}
        >
          <button
            className={`counters-cap counters-cap-total tiles-strip-cap${selGroup?.id === g.id ? ' tiles-strip-on' : ''}`}
            onClick={() => setSel({ k: 'group', id: g.id })}
            title="Edytuj grupę: nazwa, kolejność, podpis"
            onDragOver={(e) => {
              if (!dragId) return;
              e.preventDefault();
              aim(g.id, null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              land();
            }}
          >
            <span className="counters-cap-text">{g.name}</span>
            {g.hideCaption && <span className="counters-cap-sp">bez podpisu</span>}
          </button>
          <div
            className={`counters-group-row${dragId && drop?.group === g.id && drop.before === null ? ' tile-drop-end' : ''}`}
            onDragOver={(e) => {
              if (!dragId) return;
              e.preventDefault();
              aim(g.id, null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              land();
            }}
          >
            {cfg.tiles
              .filter((t) => t.group === g.id)
              .map((t, i, inGroup) => (
                <button
                  key={t.id}
                  className={`counter${selTile?.id === t.id ? ' counter-on' : ''}${dragId === t.id ? ' tile-dragging' : ''}${
                    dragId && dragId !== t.id && drop?.before === t.id ? ' tile-drop-before' : ''
                  }`}
                  style={{ ['--c' as string]: tileColorCss(t.color) } as CSSProperties}
                  aria-pressed={selTile?.id === t.id}
                  onClick={() => setSel({ k: 'tile', id: t.id })}
                  title="Edytuj kafelek — albo przeciągnij, żeby zmienić kolejność"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', t.id);
                    setDragId(t.id);
                  }}
                  onDragOver={(e) => {
                    if (!dragId) return;
                    e.preventDefault();
                    e.stopPropagation();
                    // Lewa polowa kafelka: przed nim; prawa: przed nastepnym (albo na koniec grupy).
                    const r = e.currentTarget.getBoundingClientRect();
                    const after = e.clientX > r.left + r.width / 2;
                    aim(g.id, after ? (inGroup[i + 1]?.id ?? null) : t.id);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    land();
                  }}
                  onDragEnd={endDrag}
                >
                  <span className="counter-icon">{TILE_ICON_NODES[t.icon] ?? TILE_ICON_NODES.list}</span>
                  <span className="counter-body">
                    <span className="counter-label">{t.name}</span>
                    <span className="counter-points">{t.measure === 'points' ? 'suma SP' : 'zadania'}</span>
                  </span>
                </button>
              ))}
          </div>
        </div>
      ))}
      <div className="counters-group counters-tools">
        <span className="counters-cap counters-cap-total counters-cap-static counters-cap-ghost" aria-hidden>
          <span className="counters-cap-text">&nbsp;</span>
        </span>
        <div className="counters-group-row counters-tools-row">
          {/* W trakcie przeciagania plus staje sie celem „osobno" — jedyny sposob, zeby wyjac kafelek z grupy. */}
          {dragId ? (
            <div
              className={`counter counter-add tile-drop-out${drop?.group === OUT ? ' tile-drop-out-on' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                aim(OUT, null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                land();
              }}
            >
              Osobno
            </div>
          ) : (
            <button
              className={`counter counter-add counter-icon-only${sel?.k === 'new' ? ' counter-on' : ''}`}
              onClick={() => setSel({ k: 'new' })}
              title="Nowy kafelek z bieżącego widoku"
              aria-label="Nowy kafelek"
            >
              <PlusIcon />
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(
    <>
      <div className="picker-backdrop modal-scrim" onClick={(e) => e.detail < 2 && onClose()} />
      <div className="team-modal tiles-modal" role="dialog" aria-label="Kafelki">
        <header className="team-head">
          <h2>Kafelki</h2>
          <button className="btn" onClick={onClose}>
            Zamknij
          </button>
        </header>

        {strip}

        {selTile && tileEditor(selTile)}
        {selGroup && groupEditor(selGroup)}
        {sel?.k === 'new' && newForm}
        {!sel && (
          <p className="team-empty">
            {cfg.tiles.length
              ? 'Kliknij kafelek albo nazwę grupy, żeby je edytować. Kafelek przeciągnij, żeby zmienić kolejność — także do innej grupy albo na plus, żeby stał osobno.'
              : 'Nie ma jeszcze kafelków. Wczytaj domyślne albo ustaw filtry na liście i dodaj kafelek plusem.'}
          </p>
        )}

        <footer className="tile-io">
          <button className="btn" onClick={() => void loadDefaults()} title="Zestaw procesu IT zapisany w repo (binear-kafelki-IT.json)">
            Wczytaj domyślne kafelki
          </button>
          <button className="btn" onClick={download} disabled={!cfg.tiles.length}>
            Eksportuj do pliku
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            Importuj z pliku
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              void onFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <button className="tile-tool tile-tool-danger" onClick={clearAll} disabled={!cfg.tiles.length && !cfg.groups.length}>
            Wyczyść wszystko
          </button>
          {importMsg && <span className="team-hint">{importMsg}</span>}
        </footer>
        <p className="team-hint tile-keys">
          <kbd>←</kbd> <kbd>→</kbd> wybór · <kbd>Shift</kbd>+<kbd>←</kbd> <kbd>→</kbd> przesuń · <kbd>↑</kbd> grupa ·{' '}
          <kbd>↓</kbd> kafelek · <kbd>Del</kbd> usuń · <kbd>N</kbd> nowy · <kbd>Esc</kbd> zamknij. Konfiguracja jest zapisana
          tylko w tej przeglądarce — plik pozwala przenieść ją do innych.
        </p>
      </div>
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </>,
    document.body,
  );
}
