import { describe, expect, it } from 'vitest';
import { TILE_ICON_NODES } from './tileIcons';
import {
  addGroup,
  addTile,
  colorCss,
  detachTile,
  emptyConfig,
  exportConfig,
  groupedTiles,
  groupTotals,
  importConfig,
  moveGroup,
  moveTile,
  moveToGroup,
  normalizeConfig,
  placeTile,
  removeGroup,
  removeTile,
  setGroupCaption,
  renameGroup,
  sameView,
  shownValue,
  tileValue,
  updateTile,
  TILE_ICON_KEYS,
  TILE_ICON_PICKER,
  type CustomTile,
  type TilesConfig,
} from './customTiles';

const tile = (id: string, o: Partial<CustomTile> = {}): Omit<CustomTile, 'group'> & { group?: string } => ({
  id,
  name: `Kafelek ${id}`,
  scope: 'all',
  filters: [],
  onlyMine: false,
  showDone: false,
  measure: 'count',
  color: 'blue',
  icon: 'list',
  ...o,
});

describe('normalizeConfig', () => {
  it('pusta albo zepsuta konfiguracja daje pusty zestaw', () => {
    expect(normalizeConfig(null)).toEqual({ groups: [], tiles: [] });
    expect(normalizeConfig('x')).toEqual({ groups: [], tiles: [] });
  });

  it('zachowuje poprawne kafelki i grupy, pomija zle (pusta nazwa to nie blad)', () => {
    const c = normalizeConfig(
      {
        groups: [{ id: 'g1', name: ' Magazyn ' }, { id: 'g1', name: 'dubel' }, { id: 5, name: 'zle' }],
        tiles: [
          { id: 't1', name: 'Do spakowania', group: 'g1', color: 'green', icon: 'check', measure: 'points', scope: 'sprint' },
          { id: 't1', name: 'dubel' },
          { name: 'bez id' },
          { id: 't2', name: '  ' },
        ],
      },
    );
    expect(c.groups).toEqual([{ id: 'g1', name: 'Magazyn' }]);
    expect(c.tiles.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(c.tiles[1].name).toBe('Kafelek');
    expect(c.tiles[0]).toMatchObject({ color: 'green', icon: 'check', measure: 'points', scope: 'sprint', group: 'g1' });
  });

  it('nieznany kolor, ikona i zakres wracaja do domyslnych', () => {
    const c = normalizeConfig({ groups: [{ id: 'g', name: 'G' }], tiles: [{ id: 't', name: 'A', group: 'g', color: 'zzz', icon: 'zzz', scope: 'zzz' }] });
    expect(c.tiles[0]).toMatchObject({ color: 'blue', icon: 'list', scope: 'all', measure: 'count' });
  });

  it('kafelek z nieistniejaca grupa trafia do pierwszej, a gdy grup brak — zaklada domyslna', () => {
    const c = normalizeConfig({ tiles: [{ id: 't', name: 'A', group: 'nie-ma' }] });
    expect(c.groups).toHaveLength(1);
    expect(c.tiles[0].group).toBe(c.groups[0].id);
  });
});

describe('edycja', () => {
  it('addTile zaklada domyslna grupe, gdy nie ma zadnej', () => {
    const c = addTile(emptyConfig(), tile('a'));
    expect(c.groups).toHaveLength(1);
    expect(c.tiles[0].group).toBe(c.groups[0].id);
  });

  it('kolejnosc: moveTile przesuwa w obrebie grupy, nie wychodzi poza krance', () => {
    let c = addTile(emptyConfig(), tile('a'));
    c = addTile(c, tile('b'));
    c = addTile(c, tile('c'));
    c = moveTile(c, 'c', -1);
    expect(c.tiles.map((t) => t.id)).toEqual(['a', 'c', 'b']);
    expect(moveTile(c, 'a', -1)).toBe(c);
    expect(moveTile(c, 'b', 1)).toBe(c);
  });

  it('moveToGroup przenosi na koniec innej grupy; groupedTiles pokazuje tylko niepuste', () => {
    let c = addGroup(addTile(emptyConfig(), tile('a')), 'Druga');
    const druga = c.groups[1].id;
    expect(groupedTiles(c)).toHaveLength(1);
    c = moveToGroup(c, 'a', druga);
    const g = groupedTiles(c);
    expect(g).toHaveLength(1);
    expect(g[0].group.name).toBe('Druga');
  });

  it('grupy: zmiana nazwy, kolejnosc, usuniecie razem z kafelkami', () => {
    let c = addGroup(addGroup(emptyConfig(), 'A'), 'B');
    const [a, b] = c.groups.map((g) => g.id);
    c = renameGroup(c, a, '  Magazyn ');
    expect(c.groups[0].name).toBe('Magazyn');
    c = moveGroup(c, b, -1);
    expect(c.groups.map((g) => g.id)).toEqual([b, a]);
    c = addTile(c, tile('t', { group: a }));
    c = removeGroup(c, a);
    expect(c.groups.map((g) => g.id)).toEqual([b]);
    expect(c.tiles).toEqual([]);
  });

  it('updateTile nie zmienia id; removeTile usuwa', () => {
    let c = addTile(emptyConfig(), tile('a'));
    c = updateTile(c, 'a', { name: 'Nowa', id: 'x' });
    expect(c.tiles[0]).toMatchObject({ id: 'a', name: 'Nowa' });
    expect(removeTile(c, 'a').tiles).toEqual([]);
  });
});

describe('sameView i tileValue', () => {
  const t = addTile(emptyConfig(), tile('a', { scope: 'sprint', filters: [{ field: 'epic', op: 'is', values: ['7'] }], onlyMine: true })).tiles[0];

  it('ten sam widok mimo innej kolejnosci wartosci i pustych warunkow', () => {
    expect(
      sameView(t, { scope: 'sprint', onlyMine: true, showDone: false, filters: [{ field: 'epic', op: 'is', values: ['7'] }, { field: 'tag', op: 'anyOf', values: [] }] }),
    ).toBe(true);
  });

  it('inny zakres, filtr albo przelacznik to inny widok', () => {
    const base = { scope: 'sprint' as const, onlyMine: true, showDone: false, filters: [{ field: 'epic', op: 'is', values: ['7'] }] };
    expect(sameView(t, { ...base, scope: 'all' })).toBe(false);
    expect(sameView(t, { ...base, onlyMine: false })).toBe(false);
    expect(sameView(t, { ...base, filters: [] })).toBe(false);
    expect(sameView(t, { ...base, filters: [{ field: 'epic', op: 'is', values: ['8'] }] })).toBe(false);
  });

  it('wartosc: liczba zadan albo suma SP', () => {
    const zadania = [{ storyPoints: 4 }, { storyPoints: null }, { storyPoints: 2 }];
    expect(tileValue({ measure: 'count' }, zadania)).toBe(3);
    expect(tileValue({ measure: 'points' }, zadania)).toBe(6);
  });
});

describe('eksport i import', () => {
  it('rundka: import dodaje kafelki i grupy z nowymi id, nie nadpisuje istniejacych', () => {
    let src = addTile(emptyConfig(), tile('a', { name: 'Do wysylki' }));
    src = addTile(src, tile('b', { name: 'Reklamacje' }));
    const json = exportConfig(src);

    const mine = addTile(emptyConfig(), tile('x', { name: 'Moj' }));
    const merged = importConfig(json, mine)!;
    expect(merged.tiles.map((t) => t.name)).toEqual(['Moj', 'Do wysylki', 'Reklamacje']);
    expect(new Set(merged.tiles.map((t) => t.id)).size).toBe(3);
    expect(merged.groups).toHaveLength(2);
    // zaimportowane kafelki stoja w zaimportowanej grupie
    const imported = merged.tiles[1];
    expect(merged.groups.find((g) => g.id === imported.group)).toBeTruthy();
  });

  it('plik, ktory nie jest zestawem kafelkow, jest odrzucany', () => {
    const cur = emptyConfig();
    expect(importConfig('nie json', cur)).toBeNull();
    expect(importConfig('{"a":1}', cur)).toBeNull();
    expect(importConfig(JSON.stringify({ binearTiles: 1, tiles: [] }), cur)).toBeNull();
  });
});

describe('kolor, ikony i sumy grupy', () => {
  it('kolor moze byc kluczem palety albo #rrggbb; inny wraca do domyslnego', () => {
    const t = (color: unknown) =>
      normalizeConfig({ groups: [{ id: 'g', name: 'G' }], tiles: [{ id: 't', name: 'A', group: 'g', color }] }).tiles[0].color;
    expect(t('green')).toBe('green');
    expect(t('#a1B2c3')).toBe('#a1B2c3');
    expect(t('#abc')).toBe('blue');
    expect(t('nie-kolor')).toBe('blue');
    expect(colorCss('#a1b2c3')).toBe('#a1b2c3');
    expect(colorCss('zzz')).toBe(colorCss('blue'));
  });

  it('ikon jest kilkadziesiat, a klucze sie nie powtarzaja', () => {
    expect(TILE_ICON_KEYS.length).toBeGreaterThanOrEqual(40);
    expect(new Set(TILE_ICON_KEYS).size).toBe(TILE_ICON_KEYS.length);
    // wybor: bez dubli i tylko z istniejacych kluczy
    expect(new Set(TILE_ICON_PICKER).size).toBe(TILE_ICON_PICKER.length);
    expect(TILE_ICON_PICKER.every((k) => (TILE_ICON_KEYS as readonly string[]).includes(k))).toBe(true);
  });

  it('kazdy klucz ikony ma rysunek i odwrotnie (lista w customTiles zgadza sie z tileIcons)', () => {
    expect(Object.keys(TILE_ICON_NODES).sort()).toEqual([...TILE_ICON_KEYS].sort());
  });

  it('suma grupy: zadania i SP wszystkich kafelkow; kafelek pokazuje to, co mierzy', () => {
    const values = new Map([
      ['a', { count: 4, points: 10 }],
      ['b', { count: 2, points: 3 }],
    ]);
    expect(groupTotals([{ id: 'a' }, { id: 'b' }, { id: 'brak' }], values)).toEqual({ count: 6, points: 13 });
    expect(groupTotals([], values)).toEqual({ count: 0, points: 0 });
    expect(shownValue({ measure: 'count' }, values.get('a')!)).toBe(4);
    expect(shownValue({ measure: 'points' }, values.get('a')!)).toBe(10);
  });
});

describe('grupa bez podpisu', () => {
  it('ensureLooseGroup za kazdym razem zaklada nowa grupe, a setGroupCaption przelacza podpis', async () => {
    const { ensureLooseGroup, setGroupCaption, normalizeConfig, emptyConfig } = await import('./customTiles');
    const a = ensureLooseGroup(emptyConfig());
    const b = ensureLooseGroup(a.cfg);
    expect(b.cfg.groups).toHaveLength(2);
    expect(b.id).not.toBe(a.id);
    expect(a.cfg.groups[0].hideCaption).toBe(true);
    const shown = setGroupCaption(a.cfg, a.id, true);
    expect(shown.groups[0].hideCaption).toBeUndefined();
    expect(normalizeConfig(a.cfg).groups[0].hideCaption).toBe(true);
  });
});

describe('groupTotals z nakladajacymi sie kafelkami', () => {
  it('to samo zadanie w dwoch kafelkach liczy sie raz', () => {
    const values = new Map([
      ['a', { count: 2, points: 6, rows: new Map([[1, 2], [2, 4]]) }],
      ['b', { count: 2, points: 7, rows: new Map([[2, 4], [3, 3]]) }],
    ]);
    expect(groupTotals([{ id: 'a' }, { id: 'b' }], values)).toEqual({ count: 3, points: 9 });
  });
  it('bez listy zadan zostaje suma kafelkow', () => {
    const values = new Map([
      ['a', { count: 2, points: 6 }],
      ['b', { count: 2, points: 7 }],
    ]);
    expect(groupTotals([{ id: 'a' }, { id: 'b' }], values)).toEqual({ count: 4, points: 13 });
  });
});

describe('placeTile', () => {
  const cfg: TilesConfig = {
    groups: [
      { id: 'g1', name: 'A' },
      { id: 'g2', name: 'B' },
    ],
    tiles: [
      { id: 'a', group: 'g1' },
      { id: 'b', group: 'g1' },
      { id: 'c', group: 'g1' },
      { id: 'x', group: 'g2' },
    ]
      .map((t) => ({ ...t, name: t.id, scope: 'all', filters: [], onlyMine: false, showDone: false, measure: 'count', color: 'blue', icon: 'list' }) as CustomTile),
  };
  const order = (c: TilesConfig) => c.tiles.map((t) => `${t.group}:${t.id}`).join(' ');

  it('przestawia w grupie: przed wskazanym albo na koniec', () => {
    expect(order(placeTile(cfg, 'c', 'g1', 'a'))).toBe('g1:c g1:a g1:b g2:x');
    expect(order(placeTile(cfg, 'a', 'g1', null))).toBe('g1:b g1:c g1:a g2:x');
  });

  it('przenosi do innej grupy i nie rusza konfiguracji przy upuszczeniu na siebie', () => {
    expect(order(placeTile(cfg, 'b', 'g2', 'x'))).toBe('g1:a g1:c g2:b g2:x');
    expect(order(placeTile(cfg, 'x', 'g1', null))).toBe('g1:a g1:b g1:c g1:x');
    expect(placeTile(cfg, 'b', 'g1', 'b')).toBe(cfg);
  });
});

describe('normalizeConfig — pusta nazwa', () => {
  it('kafelek i grupa z pusta nazwa (zapis w trakcie pisania) nie znikaja, tylko dostaja domyslna', () => {
    const c = normalizeConfig({
      groups: [{ id: 'g1', name: '' }],
      tiles: [{ id: 't1', name: '  ', group: 'g1', scope: 'all', filters: [], color: 'blue', icon: 'list' }],
    });
    expect(c.groups).toEqual([{ id: 'g1', name: 'Grupa' }]);
    expect(c.tiles.map((t) => [t.id, t.name, t.group])).toEqual([['t1', 'Kafelek', 'g1']]);
  });
});

describe('detachTile', () => {
  it('wyjmuje kafelek z grupy do wlasnej grupy bez podpisu na koncu', () => {
    let c = addTile(addTile(emptyConfig(), tile('a')), tile('b'));
    const g = c.groups[0].id;
    c = detachTile(c, 'a');
    expect(c.groups).toHaveLength(2);
    const own = c.groups[1];
    expect(own.hideCaption).toBe(true);
    expect(c.tiles.find((t) => t.id === 'a')?.group).toBe(own.id);
    expect(c.tiles.find((t) => t.id === 'b')?.group).toBe(g);
  });

  it('kafelek juz sam w grupie bez podpisu zostaje bez zmian', () => {
    const c = detachTile(addTile(emptyConfig(), tile('a')), 'a');
    expect(detachTile(c, 'a')).toBe(c);
  });
});

describe('puste grupy bez podpisu', () => {
  it('znikaja po wyjeciu i po przeniesieniu kafelka; nazwane zostaja', () => {
    let c = addTile(addTile(emptyConfig(), tile('a')), tile('b'));
    const named = c.groups[0].id;
    c = detachTile(c, 'a');
    c = detachTile(c, 'b');
    expect(c.groups.map((g) => g.id)).toContain(named); // nazwana, pusta — zostaje
    const loose = c.tiles.find((t) => t.id === 'a')!.group;
    c = placeTile(c, 'a', named, null);
    expect(c.groups.some((g) => g.id === loose)).toBe(false); // bez podpisu, pusta — znika
    expect(c.groups).toHaveLength(2);
  });

  it('wlasna grupa uzytkownika bez podpisu nie znika, takze przy moveToGroup i removeTile', () => {
    let c = addTile(addTile(emptyConfig(), tile('a')), tile('b'));
    const mine = c.groups[0].id;
    c = setGroupCaption(c, mine, false);
    c = detachTile(c, 'a');
    c = removeTile(c, 'b');
    expect(c.groups.some((g) => g.id === mine)).toBe(true); // pusta, bez podpisu, ale nazwana przez uzytkownika
    const loose = c.tiles.find((t) => t.id === 'a')!.group;
    c = moveToGroup(c, 'a', mine);
    expect(c.groups.some((g) => g.id === loose)).toBe(false);
    c = addTile(c, tile('b'));
    c = detachTile(c, 'b');
    const looseB = c.tiles.find((t) => t.id === 'b')!.group;
    c = removeTile(c, 'b');
    expect(c.groups.some((g) => g.id === looseB)).toBe(false);
    expect(c.groups.map((g) => g.id)).toEqual([mine]);
  });
});
