/*
 * Zakladka „Środowisko" okna „Ustawienia" (SettingsModal).
 *
 * Zmienia nie-sekretne wartosci z .env (projekt domyslny, konto „Nieprzypisane", dzialy i konta IT, moc
 * zespolu) bez edytowania pliku i bez restartu: serwer przepisuje tylko te linie i od razu je wczytuje
 * (`/api/env` w server/bxProxy.ts). Osoby i dzialy wybiera sie po nazwie, nie wpisuje numerami.
 * BITRIX_WEBHOOK tu nie trafia — to jedyny sekret i nigdy nie dociera do przegladarki.
 */

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchDepartments, fetchEnv, saveEnv, type Department, type Employee, type EnvValues, type Project } from './bitrix';
import { Picker, type Anchor, type Option } from './Picker';

type PickKind = 'person' | 'department';

interface Field {
  key: string;
  label: string;
  hint: string;
  kind: PickKind | 'project' | 'number';
  /** Jedna wartosc zamiast listy (konto „Nieprzypisane"). */
  single?: boolean;
  /** Dziala tylko w projekcie bez zespolu — z zespolem moc i kierownika bierzemy z „Zespolu i grafiku". */
  noTeamOnly?: boolean;
}

const FIELDS: Field[] = [
  { key: 'BX_GROUP_ID', label: 'Projekt domyślny', hint: 'Pokazywany na starcie, dopóki ktoś nie wybierze innego.', kind: 'project' },
  {
    key: 'BX_UNASSIGNED_ID',
    label: 'Konto „Nieprzypisane"',
    hint: 'Zadania na tym koncie pokazujemy jako niczyje.',
    kind: 'person',
    single: true,
  },
  {
    key: 'BX_IT_DEPARTMENTS',
    label: 'Działy IT',
    hint: 'Pytania w czacie zadaje IT, odpowiada ktoś spoza — stąd „Do analizy odpowiedzi".',
    kind: 'department',
  },
  { key: 'BX_IT_USERS', label: 'Konta IT spoza działów', hint: 'Np. automat, który zadaje pytania wywiadu.', kind: 'person' },
  { key: 'BX_CAPACITY_DEVS', label: 'Programiści (etaty)', hint: 'Moc zespołu, gdy nie ma ustawionego zespołu. Pół etatu = 0,5.', kind: 'number', noTeamOnly: true },
  {
    key: 'BX_CAPACITY_EXCLUDE_IDS',
    label: 'Poza limitem SP',
    hint: 'Czyje zadania nie wchodzą do limitu sprintu (np. kierownik), gdy nie ma ustawionego zespołu.',
    kind: 'person',
    noTeamOnly: true,
  },
];

const ids = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

export function EnvPane({
  directory,
  projects,
  hasTeam,
  onDirty,
  onSaved,
}: {
  directory: Employee[];
  projects: Project[];
  /** Biezacy projekt ma zespol: pola „tylko bez zespolu" sa wyszarzone (wciaz do edycji — .env jest wspolny dla projektow). */
  hasTeam: boolean;
  /** Czy formularz ma niezapisane zmiany — okno pyta o nie przy zamknieciu. */
  onDirty: (dirty: boolean) => void;
  /** Po udanym zapisie — aplikacja wczytuje konfiguracje na nowo. */
  onSaved: () => void;
}) {
  const [saved, setSaved] = useState<EnvValues | null>(null);
  const [draft, setDraft] = useState<EnvValues>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [departments, setDepartments] = useState<Department[] | null>(null);
  const [deptError, setDeptError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [picker, setPicker] = useState<{ field: Field; anchor: Anchor } | null>(null);

  useEffect(() => {
    let alive = true;
    fetchEnv()
      .then((v) => {
        if (!alive) return;
        setSaved(v);
        setDraft(v);
      })
      .catch((e) => alive && setLoadError(e instanceof Error ? e.message : String(e)));
    // Bez zakresu `department` dzialy zostaja numerami — reszta panelu dziala dalej.
    fetchDepartments()
      .then((d) => alive && setDepartments(d))
      .catch(() => alive && setDeptError(true));
    return () => {
      alive = false;
    };
  }, []);

  const personName = useMemo(() => new Map(directory.map((e) => [String(e.id), e.name])), [directory]);
  const deptName = useMemo(() => new Map((departments ?? []).map((d) => [String(d.id), d.name])), [departments]);
  const nameOf = (kind: PickKind, id: string) => (kind === 'person' ? personName : deptName).get(id) ?? `#${id}`;

  const dirty = saved !== null && FIELDS.some((f) => (draft[f.key] ?? '') !== (saved[f.key] ?? ''));
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);
  const set = (key: string, value: string) => {
    setMsg(null);
    setDraft((d) => ({ ...d, [key]: value }));
  };
  const toggle = (f: Field, id: string) => {
    if (f.single) {
      set(f.key, id);
      return;
    }
    const cur = ids(draft[f.key]);
    set(f.key, (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]).join(','));
  };

  const save = async () => {
    if (!saved || busy) return;
    const changed = Object.fromEntries(FIELDS.filter((f) => (draft[f.key] ?? '') !== (saved[f.key] ?? '')).map((f) => [f.key, draft[f.key] ?? '']));
    setBusy(true);
    try {
      const r = await saveEnv(changed);
      setSaved(r.values);
      setDraft(r.values);
      const lost = FIELDS.filter((f) => r.shadowed.includes(f.key)).map((f) => f.label);
      setMsg(
        lost.length
          ? { ok: false, text: `Zapisane w .env, ale ${lost.join(', ')} i tak bierze się z .env.local albo zmiennej systemowej.` }
          : { ok: true, text: 'Zapisane. Aplikacja wczytuje się na nowo.' },
      );
      onSaved();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const options = (f: Field): Option[] => {
    if (f.kind === 'department') return (departments ?? []).map((d) => ({ value: String(d.id), label: d.name, hint: `#${d.id}` }));
    // Osoby: aktywni pracownicy; juz wybrane konto wylaczone tez zostaje, zeby dalo sie je odznaczyc.
    const chosen = new Set(ids(draft[f.key]));
    return directory
      .filter((e) => e.active || chosen.has(String(e.id)))
      .map((e) => ({ value: String(e.id), label: e.name, photo: e.photo, hint: e.active ? undefined : 'nieaktywny' }));
  };

  const control = (f: Field) => {
    const value = draft[f.key] ?? '';
    if (f.kind === 'project') {
      const known = projects.some((p) => String(p.id) === value);
      return (
        <select className="team-select env-select" value={value} onChange={(e) => set(f.key, e.target.value)} aria-label={f.label}>
          {!known && value && <option value={value}>#{value}</option>}
          {projects.map((p) => (
            <option key={p.id} value={String(p.id)}>
              {p.name}
            </option>
          ))}
        </select>
      );
    }
    if (f.kind === 'number') {
      return (
        <input
          className="picker-input env-number"
          inputMode="decimal"
          value={value}
          aria-label={f.label}
          onChange={(e) => set(f.key, e.target.value)}
        />
      );
    }
    const kind = f.kind;
    // Dzialy bez dostepu do struktury firmy: zostaje wpisanie numerow, jak w .env.
    if (kind === 'department' && deptError) {
      return (
        <input
          className="picker-input"
          value={value}
          placeholder="np. 79,81"
          aria-label={f.label}
          onChange={(e) => set(f.key, e.target.value)}
        />
      );
    }
    const chosen = ids(value);
    return (
      <span className="env-chips">
        {chosen.map((id) => (
          <span key={id} className="env-chip" title={`#${id}`}>
            <span className="env-chip-name">{nameOf(kind, id)}</span>
            {!f.single && (
              <button className="env-chip-x" aria-label={`Usuń ${nameOf(kind, id)}`} onClick={() => toggle(f, id)}>
                ×
              </button>
            )}
          </span>
        ))}
        <button
          className="env-add"
          disabled={kind === 'department' && !departments}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setPicker({ field: f, anchor: { left: r.left, top: r.top, bottom: r.bottom } });
          }}
        >
          {f.single ? 'Zmień' : chosen.length ? '+' : '+ Dodaj'}
        </button>
      </span>
    );
  };

  return (
    <div className="env-pane">
      <div className="ds-colhint">
        Wartości z pliku .env, wspólne dla wszystkich na tej instancji. Zapis zmienia tylko te linie — bez restartu. Webhook się tu nie pokazuje.
      </div>
      {loadError && <div className="env-msg env-msg-err">Nie udało się wczytać: {loadError}</div>}
      {saved &&
        FIELDS.map((f) => (
          <div key={f.key} className={`env-row${f.noTeamOnly && hasTeam ? ' env-row-off' : ''}`}>
            <span className="env-label" title={f.key}>
              {f.label}
            </span>
            <span className="env-control">{control(f)}</span>
            <span className="env-hint">
              {f.kind === 'department' && deptError
                ? 'Webhook nie widzi struktury firmy (zakres department) — wpisz numery działów po przecinku.'
                : f.noTeamOnly && hasTeam
                  ? `${f.hint} Ten projekt ma zespół — tu nieużywane (liczy się „Zespół i grafik"); działa w projektach bez zespołu.`
                  : f.hint}
            </span>
          </div>
        ))}
      {msg && <div className={`env-msg${msg.ok ? '' : ' env-msg-err'}`}>{msg.text}</div>}
      {saved && (
        <div className="perms-actions">
          <button className="btn" disabled={!dirty || busy} onClick={() => { setDraft(saved); setMsg(null); }}>
            Cofnij
          </button>
          <button className="btn btn-primary perms-run" disabled={!dirty || busy} onClick={() => void save()}>
            {busy ? 'Zapisywanie…' : 'Zapisz'}
          </button>
        </div>
      )}

      {/* Okno ustawien ma transform — popover z position: fixed wychodzi do body, nad okno. */}
      {picker &&
        createPortal(
          <div className="settings-layer">
            <Picker
              title={picker.field.label}
              anchor={picker.anchor}
              options={options(picker.field)}
              placeholder={picker.field.kind === 'department' ? 'Szukaj działu…' : 'Szukaj osoby…'}
              multi={!picker.field.single}
              selected={ids(draft[picker.field.key])}
              onToggle={(v) => toggle(picker.field, v)}
              onPick={(v) => {
                toggle(picker.field, v);
                setPicker(null);
              }}
              onClose={() => setPicker(null)}
            />
          </div>,
          document.body,
        )}
    </div>
  );
}
