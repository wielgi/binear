import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { AskDialog, type AskState } from './AskDialog';
import { addEpic, deleteEpic, editEpic as saveEpic, fetchTaskTags, updateTags, type Epic, type Task } from './bitrix';
import { isHexColor } from './customTiles';
import { otwartych, zadan } from './plural';

type Tab = 'tags' | 'epics';

/** Tag bez rozrozniania wielkosci liter — tak traktuje je Bitrix (BUG i bug to jeden tag). */
const same = (a: string, b: string) => a.localeCompare(b, 'pl', { sensitivity: 'accent' }) === 0;

/** Zadanie zamkniete (zakonczone albo odrzucone) — zmiany hurtowe tagow go nie dotycza. */
export const isClosedTask = (t: Pick<Task, 'status'>): boolean => t.status === '5' || t.status === '7';

/** Nowy zestaw tagow zadania po zamianie `from` na `to` (`null` = usuniecie), bez dubli. */
export function replaceTag(tags: readonly string[], from: string, to: string | null): string[] {
  const out: string[] = [];
  for (const t of tags) {
    const next = same(t, from) ? to : t;
    if (next && !out.some((x) => same(x, next))) out.push(next);
  }
  return out;
}

/**
 * Zarzadzanie tagami i epikami projektu w jednym miejscu. Tag w Bitriksie to tylko nazwa przy zadaniu
 * (nie ma slownika), wiec zmiana nazwy, scalenie i usuniecie to hurtowa zmiana zadan, ktore go maja.
 * Epik ma w Bitriksie osobne metody (dodaj / zmien / usun). Zakladka okna „Ustawienia" (SettingsModal).
 */
export function ManagePane({
  tasks,
  epics,
  groupId,
  initialTab,
  onChanged,
  onBusy,
}: {
  tasks: Task[];
  epics: Epic[];
  groupId: number | null;
  initialTab: Tab;
  /** Po zmianie trzeba przeladowac dane z Bitriksa; okno czeka na koniec, zanim pozwoli na nastepna zmiane. */
  onChanged: () => Promise<unknown> | void;
  /** W trakcie zapisu okno nie daje sie zamknac ani przelaczyc na inna zakladke — postep i blad zniknelyby z oczu. */
  onBusy: (busy: boolean) => void;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [ask, setAsk] = useState<AskState | null>(null);

  /*
   * Zapis w toku albo otwarte pytanie: okno nie zamyka sie (takze Esc) i nie przelacza zakladki — zmiana leci dalej,
   * a zniknelby postep i blad. Esc z pola zmiany nazwy zalatwia samo pole (defaultPrevented).
   */
  useEffect(() => {
    onBusy(Boolean(busy) || Boolean(ask));
  }, [busy, ask, onBusy]);
  useEffect(() => () => onBusy(false), [onBusy]);

  /*
   * Jedna zmiana naraz, a okno odblokowuje sie dopiero po odswiezeniu danych — takze po bledzie, bo czesc
   * zadan mogla juz zostac zmieniona. Przy bledzie w polowie mowimy, ile zdazylo sie zapisac.
   */
  const run = async (label: string, job: (progress: (done: number, total: number) => void) => Promise<void>) => {
    setMsg(null);
    setBusy(`${label}…`);
    let done = 0;
    let total = 0;
    try {
      await job((d, t) => {
        done = d;
        total = t;
        setBusy(`${label}… ${d}/${t}`);
      });
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      setMsg(total ? `Nie udało się po ${done} z ${zadan(total)}: ${why}. Zmienione zostają, resztę możesz powtórzyć.` : `Nie udało się: ${why}`);
    } finally {
      setBusy('Odświeżam dane…');
      await Promise.resolve(onChanged()).catch(() => undefined);
      setBusy(null);
    }
  };

  return (
    <>
      <div className="ds-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'tags'} className={`ds-tab${tab === 'tags' ? ' ds-tab-on' : ''}`} onClick={() => setTab('tags')}>
          Tagi
        </button>
        <button role="tab" aria-selected={tab === 'epics'} className={`ds-tab${tab === 'epics' ? ' ds-tab-on' : ''}`} onClick={() => setTab('epics')}>
          Epiki
        </button>
      </div>

      {busy && <p className="team-hint">{busy}</p>}
      {msg && <p className="team-hint manage-error">{msg}</p>}

      {tab === 'tags' ? (
        <TagsPane tasks={tasks} busy={Boolean(busy)} run={run} ask={setAsk} />
      ) : (
        <EpicsPane tasks={tasks} epics={epics} groupId={groupId} busy={Boolean(busy)} run={run} ask={setAsk} />
      )}
      {/* Okno ustawien ma transform — dialog z position: fixed musi wyjsc do body, inaczej staje wzgledem okna. */}
      {ask && createPortal(<AskDialog ask={ask} onClose={() => setAsk(null)} />, document.body)}
    </>
  );
}

type Run = (label: string, job: (progress: (done: number, total: number) => void) => Promise<void>) => Promise<void>;
type Ask = (a: AskState) => void;

function TagsPane({ tasks, busy, run, ask }: { tasks: Task[]; busy: boolean; run: Run; ask: Ask }) {
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const rows = useMemo(() => {
    const m = new Map<string, { name: string; all: number; open: number }>();
    for (const t of tasks) {
      for (const tag of t.tags) {
        const key = tag.toLowerCase();
        const r = m.get(key) ?? { name: tag, all: 0, open: 0 };
        r.all++;
        if (t.status !== '5' && t.status !== '7') r.open++;
        m.set(key, r);
      }
    }
    return [...m.values()].sort(
      (a, b) => b.all - a.all || a.name.localeCompare(b.name, 'pl', { sensitivity: 'base', numeric: true }),
    );
  }, [tasks]);
  const shown = q.trim() ? rows.filter((r) => r.name.toLowerCase().includes(q.trim().toLowerCase())) : rows;

  /** Otwarte zadania z tagiem; zamkniete zostaja bez zmian (to historia, nie ma ich po co przepisywac). */
  const withTag = (tag: string) => tasks.filter((t) => !isClosedTask(t) && t.tags.some((x) => same(x, tag)));

  /*
   * Kazde zadanie: najpierw AKTUALNE tagi z Bitriksa, dopiero na nich zamiana. Lista w aplikacji moze byc stara
   * (poprzednia zmiana jeszcze sie nie odswiezyla, ktos dodal tag w Bitriksie) — zapis calego TAGS na jej
   * podstawie wskrzeszal stary tag albo gubil cudzy. Zadanie, na ktorym tagu juz nie ma, pomijamy.
   */
  const change = (tag: string, to: string | null) => {
    const list = withTag(tag);
    void run(to ? `Zmieniam „${tag}” → „${to}”` : `Usuwam „${tag}”`, async (progress) => {
      for (let i = 0; i < list.length; i++) {
        const fresh = await fetchTaskTags(list[i].id);
        if (fresh.some((x) => same(x, tag))) await updateTags(list[i].id, replaceTag(fresh, tag, to));
        progress(i + 1, list.length);
      }
    });
  };

  /** Pytanie przed zmiana hurtowa: ile otwartych zadan, czy to scalenie, ze zamkniete zostaja. */
  const confirmChange = (r: { name: string; all: number; open: number }, to: string | null) => {
    const closed = r.all - r.open;
    const target = to ? rows.find((x) => same(x.name, to) && !same(x.name, r.name)) : undefined;
    const rest = closed ? ` Zamknięte zadania (${closed}) zostają bez zmian.` : '';
    ask(
      to === null
        ? {
            title: `Usunąć tag „${r.name}”?`,
            body: `Tag zniknie z otwartych zadań (${r.open}).${rest}`,
            actions: [{ label: 'Usuń tag', kind: 'danger', run: () => change(r.name, null) }],
          }
        : {
            title: target ? `Scalić „${r.name}” z „${target.name}”?` : `Zmienić nazwę „${r.name}” na „${to}”?`,
            body: target
              ? `Otwarte zadania (${r.open}) dostaną tag „${target.name}” zamiast „${r.name}”. Scalenia nie da się potem rozdzielić.${rest}`
              : `Zmiana w otwartych zadaniach (${r.open}).${rest}`,
            actions: [{ label: target ? 'Scal' : 'Zmień nazwę', kind: 'primary', run: () => change(r.name, target ? target.name : to) }],
          },
    );
  };

  return (
    <>
      <input className="picker-input tile-row-name" placeholder="Szukaj tagu…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="manage-list">
        {shown.map((r) => (
          <div key={r.name} className="manage-row">
            {editing === r.name ? (
              <>
                <input
                  className="tile-row-name"
                  value={draft}
                  autoFocus
                  maxLength={60}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      // Esc cofa sama edycje nazwy, nie zamyka calego okna.
                      e.preventDefault();
                      setEditing(null);
                    }
                    if (e.key === 'Enter' && draft.trim() && !same(draft.trim(), r.name)) {
                      /* Bez tego ten sam Enter (keypress) trafia w przycisk dialogu, ktory wlasnie dostal fokus,
                         i zmiana rusza bez potwierdzenia. */
                      e.preventDefault();
                      setEditing(null);
                      confirmChange(r, draft.trim());
                    }
                  }}
                />
                <span className="team-hint">
                  Enter zapisze w otwartych zadaniach ({r.open}){rows.some((x) => same(x.name, draft.trim()) && !same(x.name, r.name)) ? ' (scali z istniejącym tagiem)' : ''}
                </span>
                <button className="btn" onClick={() => setEditing(null)}>
                  Anuluj
                </button>
              </>
            ) : (
              <>
                <span className="manage-name">{r.name}</span>
                <span className="team-hint">
                  {zadan(r.all)} ({otwartych(r.open)})
                </span>
                <button
                  className="btn"
                  disabled={busy || r.open === 0}
                  onClick={() => {
                    setEditing(r.name);
                    setDraft(r.name);
                  }}
                  title={r.open ? 'Zmień nazwę albo scal z innym tagiem (wpisz jego nazwę)' : 'Tag jest już tylko na zamkniętych zadaniach'}
                >
                  Zmień / scal
                </button>
                <button
                  className="btn"
                  disabled={busy || r.open === 0}
                  onClick={() => confirmChange(r, null)}
                  title={r.open ? 'Zdejmij tag z otwartych zadań' : 'Tag jest już tylko na zamkniętych zadaniach'}
                >
                  Usuń
                </button>
              </>
            )}
          </div>
        ))}
        {shown.length === 0 && <p className="team-empty">Brak tagów.</p>}
      </div>
      <p className="team-hint">
        Bitrix nie ma słownika tagów — tag to nazwa przy zadaniu, więc zmiana nazwy, scalenie i usunięcie aktualizują otwarte zadania z
        tym tagiem (każde czytane z Bitriksa tuż przed zapisem). Zamknięte zadania zostają bez zmian.
      </p>
    </>
  );
}

function EpicsPane({
  tasks,
  epics,
  groupId,
  busy,
  run,
  ask,
}: {
  tasks: Task[];
  epics: Epic[];
  groupId: number | null;
  busy: boolean;
  run: Run;
  ask: Ask;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#58a6ff');
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const count = (id: number) => tasks.filter((t) => t.epicId === id).length;

  return (
    <>
      <div className="manage-list">
        {/* Jak tagi: najczesciej uzywane na gorze, przy remisie po nazwie. */}
        {[...epics]
          .sort((a, b) => count(b.id) - count(a.id) || a.name.localeCompare(b.name, 'pl'))
          .map((e) => (
          <div key={e.id} className="manage-row">
            {editing === e.id ? (
              <>
                <input
                  className="tile-row-name"
                  value={draft}
                  autoFocus
                  maxLength={60}
                  onChange={(ev) => setDraft(ev.target.value)}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Escape') {
                      // Tylko anuluje zmiane nazwy — bez tego Esc zamykal cale okno.
                      ev.preventDefault();
                      setEditing(null);
                    }
                    if (ev.key === 'Enter' && draft.trim()) {
                      setEditing(null);
                      void run('Zapisuję epik', () => saveEpic(e.id, { name: draft.trim() }));
                    }
                  }}
                />
                <button className="btn" onClick={() => setEditing(null)}>
                  Anuluj
                </button>
              </>
            ) : (
              <>
                <span className="manage-name">{e.name}</span>
                <span className="team-hint">{zadan(count(e.id))}</span>
                <EpicColor
                  value={e.color && isHexColor(`#${e.color}`) ? `#${e.color}` : '#58a6ff'}
                  disabled={busy}
                  label={`Kolor epiku ${e.name}`}
                  onCommit={(c) => void run('Zapisuję kolor', () => saveEpic(e.id, { color: c }))}
                />
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => {
                    setEditing(e.id);
                    setDraft(e.name);
                  }}
                >
                  Zmień nazwę
                </button>
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() =>
                    ask({
                      title: `Usunąć epik „${e.name}”?`,
                      body: `Zadania (${count(e.id)}) stracą przypisanie do niego.`,
                      actions: [{ label: 'Usuń epik', kind: 'danger', run: () => void run('Usuwam epik', () => deleteEpic(e.id)) }],
                    })
                  }
                >
                  Usuń
                </button>
              </>
            )}
          </div>
        ))}
        {epics.length === 0 && <p className="team-empty">Ten projekt nie ma epików.</p>}
      </div>

      <label className="team-add">
        <span>Nowy epik</span>
        <input className="picker-input" placeholder="nazwa" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        <span className="tile-swatch tile-swatch-custom" title="Kolor nowego epiku" style={{ background: color }}>
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Kolor nowego epiku" />
        </span>
        <button
          className="btn btn-primary"
          disabled={busy || !name.trim() || groupId === null}
          onClick={() => {
            const n = name.trim();
            setName('');
            if (groupId !== null) void run('Dodaję epik', () => addEpic(groupId, n, color));
          }}
        >
          Dodaj
        </button>
      </label>
    </>
  );
}

/*
 * Kolor epiku: podglad zmienia sie przy przeciaganiu, a zapis idzie RAZ — na natywne `change`, czyli gdy picker
 * sie zamyka. Reactowe `onChange` odpala sie przy kazdym ruchu myszy i wysylalo dziesiatki zapisow do Bitriksa.
 */
function EpicColor({
  value,
  disabled,
  label,
  onCommit,
}: {
  value: string;
  disabled: boolean;
  label: string;
  onCommit: (color: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  const commit = useRef(onCommit);
  commit.current = onCommit;
  // Po zapisie (okno odblokowane, dane przeladowane) probka pokazuje to, co jest w Bitriksie — po bledzie wraca stary kolor.
  useEffect(() => {
    if (!disabled) setDraft(value);
  }, [value, disabled]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const done = () => {
      if (el.value.toLowerCase() !== value.toLowerCase()) commit.current(el.value);
    };
    el.addEventListener('change', done);
    return () => el.removeEventListener('change', done);
  }, [value]);
  return (
    <label className="tile-swatch tile-swatch-custom" title="Zmień kolor" style={{ background: draft }}>
      <input ref={ref} type="color" value={draft} disabled={disabled} onChange={(ev) => setDraft(ev.target.value)} aria-label={label} />
    </label>
  );
}
