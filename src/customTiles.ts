/*
 * Wlasne kafelki: zapisany widok (zakres + filtry) z ustawieniami wyswietlania — nazwa, kolor, ikona,
 * grupa, kolejnosc. Dzieki temu licznik nie jest wpisany w kod pod jeden proces (IT), tylko kazdy dzial
 * sklada sobie wlasne kafelki z tych samych filtrow, ktorych uzywa na liscie.
 *
 * Sama logika i zapis w przegladarce, bez Reacta (patrz customTiles.test.ts).
 */

export type TileScope = 'sprint' | 'outside' | 'all';

/** Warunek filtra w postaci zapisywalnej (bez `id` — ten powstaje dopiero przy zastosowaniu na pasku). */
export interface TileCondition {
  field: string;
  op: string;
  values: string[];
}

/** Co kafelek pokazuje jako liczbe: liczbe zadan albo sume story pointow. */
export type TileMeasure = 'count' | 'points';

export interface CustomTile {
  id: string;
  name: string;
  scope: TileScope;
  filters: TileCondition[];
  /** „Tylko moje" w momencie zapisu widoku. */
  onlyMine: boolean;
  /** „Pokaz zakonczone" w momencie zapisu widoku. */
  showDone: boolean;
  measure: TileMeasure;
  /** Klucz z `TILE_COLORS`. */
  color: string;
  /** Klucz z `TILE_ICONS`. */
  icon: string;
  /** Id grupy; kafelki jednej grupy stoja razem pod jej podpisem. */
  group: string;
}

export interface TileGroup {
  id: string;
  name: string;
}

export interface TilesConfig {
  /** Zestaw „proces IT": wbudowane kafelki (Do wyceny, Gotowe do startu …). */
  itPack: boolean;
  groups: TileGroup[];
  /** Kolejnosc kafelkow = kolejnosc w tablicy (w obrebie grupy). */
  tiles: CustomTile[];
}

/** Paleta: klucz → zmienna CSS albo kolor. Klucz zapisujemy, wiec motyw moze zmienic odcien. */
export const TILE_COLORS: Record<string, { label: string; css: string }> = {
  green: { label: 'Zielony', css: 'var(--accent-green)' },
  blue: { label: 'Niebieski', css: '#58a6ff' },
  teal: { label: 'Morski', css: '#2bb8c9' },
  purple: { label: 'Fioletowy', css: '#a371f7' },
  amber: { label: 'Żółty', css: 'var(--accent-amber)' },
  orange: { label: 'Pomarańczowy', css: 'var(--accent-orange)' },
  red: { label: 'Czerwony', css: 'var(--danger)' },
  grey: { label: 'Szary', css: '#8b949e' },
};

/** Klucze ikon do wyboru; same rysunki mapuje warstwa UI (`TilesBar`). */
export const TILE_ICON_KEYS = [
  'list',
  'check',
  'pen',
  'history',
  'comment',
  'hash',
  'calendar',
  'flame',
  'bug',
  'bulb',
  'parent',
  'layers',
  'tag',
  'person',
  'eye',
] as const;

export const DEFAULT_COLOR = 'blue';
export const DEFAULT_ICON = 'list';
export const DEFAULT_GROUP_NAME = 'Moje kafelki';

let seq = 0;
/** Id niepowtarzalne takze po odswiezeniu strony (czas + licznik). */
export const newId = (prefix: string): string => `${prefix}${Date.now().toString(36)}${(++seq).toString(36)}`;

export const emptyConfig = (itPack: boolean): TilesConfig => ({ itPack, groups: [], tiles: [] });

const isScope = (v: unknown): v is TileScope => v === 'sprint' || v === 'outside' || v === 'all';

/** Zbiera wejscie (z localStorage albo z pliku) do poprawnej konfiguracji; zle elementy pomija. */
export function normalizeConfig(raw: unknown, fallbackItPack: boolean): TilesConfig {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Partial<TilesConfig>;
  const groups: TileGroup[] = [];
  for (const g of Array.isArray(src.groups) ? src.groups : []) {
    if (g && typeof g.id === 'string' && typeof g.name === 'string' && g.name.trim() && !groups.some((x) => x.id === g.id)) {
      groups.push({ id: g.id, name: g.name.trim().slice(0, 40) });
    }
  }
  const tiles: CustomTile[] = [];
  for (const t of Array.isArray(src.tiles) ? src.tiles : []) {
    if (!t || typeof t.id !== 'string' || typeof t.name !== 'string' || !t.name.trim()) continue;
    if (tiles.some((x) => x.id === t.id)) continue;
    const filters: TileCondition[] = (Array.isArray(t.filters) ? t.filters : [])
      .filter((c) => c && typeof c.field === 'string' && typeof c.op === 'string' && Array.isArray(c.values))
      .map((c) => ({ field: c.field, op: c.op, values: c.values.map(String) }));
    // Kafelek bez istniejacej grupy trafia do pierwszej (albo do nowej domyslnej) — nic nie znika po cichu.
    let group = typeof t.group === 'string' && groups.some((g) => g.id === t.group) ? t.group : '';
    if (!group) {
      if (!groups.length) groups.push({ id: newId('g'), name: DEFAULT_GROUP_NAME });
      group = groups[0].id;
    }
    tiles.push({
      id: t.id,
      name: t.name.trim().slice(0, 40),
      scope: isScope(t.scope) ? t.scope : 'all',
      filters,
      onlyMine: t.onlyMine === true,
      showDone: t.showDone === true,
      measure: t.measure === 'points' ? 'points' : 'count',
      color: typeof t.color === 'string' && TILE_COLORS[t.color] ? t.color : DEFAULT_COLOR,
      icon: typeof t.icon === 'string' && (TILE_ICON_KEYS as readonly string[]).includes(t.icon) ? t.icon : DEFAULT_ICON,
      group,
    });
  }
  return { itPack: typeof src.itPack === 'boolean' ? src.itPack : fallbackItPack, groups, tiles };
}

/** Grupy z ich kafelkami w kolejnosci wyswietlania; pustych grup nie zwraca. */
export function groupedTiles(cfg: TilesConfig): { group: TileGroup; tiles: CustomTile[] }[] {
  return cfg.groups
    .map((group) => ({ group, tiles: cfg.tiles.filter((t) => t.group === group.id) }))
    .filter((g) => g.tiles.length > 0);
}

/** Dodaje kafelek; gdy grupy nie ma, zaklada domyslna. */
export function addTile(cfg: TilesConfig, tile: Omit<CustomTile, 'group'> & { group?: string }): TilesConfig {
  let groups = cfg.groups;
  let group = tile.group && groups.some((g) => g.id === tile.group) ? tile.group : groups[0]?.id;
  if (!group) {
    group = newId('g');
    groups = [...groups, { id: group, name: DEFAULT_GROUP_NAME }];
  }
  return { ...cfg, groups, tiles: [...cfg.tiles, { ...tile, group }] };
}

export const updateTile = (cfg: TilesConfig, id: string, patch: Partial<CustomTile>): TilesConfig => ({
  ...cfg,
  tiles: cfg.tiles.map((t) => (t.id === id ? { ...t, ...patch, id: t.id } : t)),
});

export const removeTile = (cfg: TilesConfig, id: string): TilesConfig => ({
  ...cfg,
  tiles: cfg.tiles.filter((t) => t.id !== id),
});

/** Przesuwa kafelek o jedno miejsce w obrebie jego grupy (-1 w gore, +1 w dol). */
export function moveTile(cfg: TilesConfig, id: string, dir: -1 | 1): TilesConfig {
  const tile = cfg.tiles.find((t) => t.id === id);
  if (!tile) return cfg;
  const inGroup = cfg.tiles.filter((t) => t.group === tile.group);
  const at = inGroup.findIndex((t) => t.id === id);
  const other = inGroup[at + dir];
  if (!other) return cfg;
  const tiles = [...cfg.tiles];
  const i = tiles.findIndex((t) => t.id === id);
  const j = tiles.findIndex((t) => t.id === other.id);
  [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
  return { ...cfg, tiles };
}

/** Przenosi kafelek do innej grupy (na jej koniec). */
export function moveToGroup(cfg: TilesConfig, id: string, groupId: string): TilesConfig {
  if (!cfg.groups.some((g) => g.id === groupId)) return cfg;
  const tile = cfg.tiles.find((t) => t.id === id);
  if (!tile || tile.group === groupId) return cfg;
  return { ...cfg, tiles: [...cfg.tiles.filter((t) => t.id !== id), { ...tile, group: groupId }] };
}

export const addGroup = (cfg: TilesConfig, name: string): TilesConfig =>
  name.trim() ? { ...cfg, groups: [...cfg.groups, { id: newId('g'), name: name.trim().slice(0, 40) }] } : cfg;

export const renameGroup = (cfg: TilesConfig, id: string, name: string): TilesConfig =>
  name.trim() ? { ...cfg, groups: cfg.groups.map((g) => (g.id === id ? { ...g, name: name.trim().slice(0, 40) } : g)) } : cfg;

/** Przesuwa grupe o jedno miejsce. */
export function moveGroup(cfg: TilesConfig, id: string, dir: -1 | 1): TilesConfig {
  const i = cfg.groups.findIndex((g) => g.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= cfg.groups.length) return cfg;
  const groups = [...cfg.groups];
  [groups[i], groups[j]] = [groups[j], groups[i]];
  return { ...cfg, groups };
}

/** Usuwa grupe razem z jej kafelkami; zwraca tez, ile kafelkow poszlo. */
export function removeGroup(cfg: TilesConfig, id: string): TilesConfig {
  return { ...cfg, groups: cfg.groups.filter((g) => g.id !== id), tiles: cfg.tiles.filter((t) => t.group !== id) };
}

/** Czy aktualny stan listy to dokladnie widok tego kafelka — do podswietlenia kafelka. */
export function sameView(
  tile: CustomTile,
  state: { scope: TileScope; filters: readonly TileCondition[]; onlyMine: boolean; showDone: boolean },
): boolean {
  const key = (c: TileCondition) => `${c.field}|${c.op}|${[...c.values].sort().join(',')}`;
  const a = tile.filters.filter((c) => c.values.length).map(key).sort();
  const b = state.filters.filter((c) => c.values.length).map(key).sort();
  return (
    tile.scope === state.scope &&
    tile.onlyMine === state.onlyMine &&
    tile.showDone === state.showDone &&
    a.length === b.length &&
    a.every((x, i) => x === b[i])
  );
}

/** Wartosc kafelka dla juz przefiltrowanych zadan. */
export function tileValue(tile: Pick<CustomTile, 'measure'>, tasks: readonly { storyPoints: number | null }[]): number {
  return tile.measure === 'points' ? tasks.reduce((n, t) => n + (t.storyPoints ?? 0), 0) : tasks.length;
}

/* ---------- eksport / import ---------- */

export const EXPORT_VERSION = 1;

export function exportConfig(cfg: TilesConfig): string {
  return JSON.stringify({ binearTiles: EXPORT_VERSION, groups: cfg.groups, tiles: cfg.tiles }, null, 2);
}

/**
 * Import z pliku: `null`, gdy to nie jest plik kafelkow. Id grup i kafelkow sa generowane od nowa, wiec
 * import dodaje do istniejacej konfiguracji, a nie nadpisuje jej ani nie dubluje identyfikatorow.
 */
export function importConfig(text: string, current: TilesConfig): TilesConfig | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object' || (data as { binearTiles?: unknown }).binearTiles !== EXPORT_VERSION) return null;
  const clean = normalizeConfig(data, current.itPack);
  if (!clean.tiles.length) return null;
  const groupMap = new Map(clean.groups.map((g) => [g.id, newId('g')]));
  const groups = [...current.groups, ...clean.groups.map((g) => ({ ...g, id: groupMap.get(g.id) as string }))];
  const tiles = [
    ...current.tiles,
    ...clean.tiles.map((t) => ({ ...t, id: newId('t'), group: groupMap.get(t.group) as string })),
  ];
  return { ...current, groups, tiles };
}

/* ---------- zapis w przegladarce ---------- */

const STORAGE_KEY = 'binear.tiles.v1';

/**
 * Wczytuje konfiguracje. Zestaw „proces IT" domyslnie jest WYLACZONY dla swiezej instalacji, ale wlaczony
 * dla kogos, kto juz uzywal binear (`hadSettings`) — inaczej istniejacemu uzytkownikowi zniknalyby kafelki.
 */
export function loadTiles(hadSettings: boolean): TilesConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyConfig(hadSettings);
    return normalizeConfig(JSON.parse(raw), hadSettings);
  } catch {
    return emptyConfig(hadSettings);
  }
}

export function saveTiles(cfg: TilesConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    /* Brak miejsca albo zablokowany zapis — konfiguracja zyje do konca sesji. */
  }
}
