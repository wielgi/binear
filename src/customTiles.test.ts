import { describe, expect, it } from 'vitest';
import {
  addGroup,
  addTile,
  emptyConfig,
  exportConfig,
  groupedTiles,
  importConfig,
  moveGroup,
  moveTile,
  moveToGroup,
  normalizeConfig,
  removeGroup,
  removeTile,
  renameGroup,
  sameView,
  tileValue,
  updateTile,
  type CustomTile,
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
  it('pusta albo zepsuta konfiguracja daje pusty zestaw z zadana flaga IT', () => {
    expect(normalizeConfig(null, true)).toEqual({ itPack: true, groups: [], tiles: [] });
    expect(normalizeConfig('x', false).itPack).toBe(false);
  });

  it('zachowuje poprawne kafelki i grupy, pomija zle', () => {
    const c = normalizeConfig(
      {
        itPack: false,
        groups: [{ id: 'g1', name: ' Magazyn ' }, { id: 'g1', name: 'dubel' }, { id: 5, name: 'zle' }],
        tiles: [
          { id: 't1', name: 'Do spakowania', group: 'g1', color: 'green', icon: 'check', measure: 'points', scope: 'sprint' },
          { id: 't1', name: 'dubel' },
          { name: 'bez id' },
          { id: 't2', name: '  ' },
        ],
      },
      true,
    );
    expect(c.groups).toEqual([{ id: 'g1', name: 'Magazyn' }]);
    expect(c.tiles.map((t) => t.id)).toEqual(['t1']);
    expect(c.tiles[0]).toMatchObject({ color: 'green', icon: 'check', measure: 'points', scope: 'sprint', group: 'g1' });
    expect(c.itPack).toBe(false);
  });

  it('nieznany kolor, ikona i zakres wracaja do domyslnych', () => {
    const c = normalizeConfig({ groups: [{ id: 'g', name: 'G' }], tiles: [{ id: 't', name: 'A', group: 'g', color: 'zzz', icon: 'zzz', scope: 'zzz' }] }, true);
    expect(c.tiles[0]).toMatchObject({ color: 'blue', icon: 'list', scope: 'all', measure: 'count' });
  });

  it('kafelek z nieistniejaca grupa trafia do pierwszej, a gdy grup brak — zaklada domyslna', () => {
    const c = normalizeConfig({ tiles: [{ id: 't', name: 'A', group: 'nie-ma' }] }, true);
    expect(c.groups).toHaveLength(1);
    expect(c.tiles[0].group).toBe(c.groups[0].id);
  });
});

describe('edycja', () => {
  it('addTile zaklada domyslna grupe, gdy nie ma zadnej', () => {
    const c = addTile(emptyConfig(false), tile('a'));
    expect(c.groups).toHaveLength(1);
    expect(c.tiles[0].group).toBe(c.groups[0].id);
  });

  it('kolejnosc: moveTile przesuwa w obrebie grupy, nie wychodzi poza krance', () => {
    let c = addTile(emptyConfig(false), tile('a'));
    c = addTile(c, tile('b'));
    c = addTile(c, tile('c'));
    c = moveTile(c, 'c', -1);
    expect(c.tiles.map((t) => t.id)).toEqual(['a', 'c', 'b']);
    expect(moveTile(c, 'a', -1)).toBe(c);
    expect(moveTile(c, 'b', 1)).toBe(c);
  });

  it('moveToGroup przenosi na koniec innej grupy; groupedTiles pokazuje tylko niepuste', () => {
    let c = addGroup(addTile(emptyConfig(false), tile('a')), 'Druga');
    const druga = c.groups[1].id;
    expect(groupedTiles(c)).toHaveLength(1);
    c = moveToGroup(c, 'a', druga);
    const g = groupedTiles(c);
    expect(g).toHaveLength(1);
    expect(g[0].group.name).toBe('Druga');
  });

  it('grupy: zmiana nazwy, kolejnosc, usuniecie razem z kafelkami', () => {
    let c = addGroup(addGroup(emptyConfig(false), 'A'), 'B');
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
    let c = addTile(emptyConfig(false), tile('a'));
    c = updateTile(c, 'a', { name: 'Nowa', id: 'x' });
    expect(c.tiles[0]).toMatchObject({ id: 'a', name: 'Nowa' });
    expect(removeTile(c, 'a').tiles).toEqual([]);
  });
});

describe('sameView i tileValue', () => {
  const t = addTile(emptyConfig(false), tile('a', { scope: 'sprint', filters: [{ field: 'epic', op: 'is', values: ['7'] }], onlyMine: true })).tiles[0];

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
    let src = addTile(emptyConfig(false), tile('a', { name: 'Do wysylki' }));
    src = addTile(src, tile('b', { name: 'Reklamacje' }));
    const json = exportConfig(src);

    const mine = addTile(emptyConfig(true), tile('x', { name: 'Moj' }));
    const merged = importConfig(json, mine)!;
    expect(merged.itPack).toBe(true);
    expect(merged.tiles.map((t) => t.name)).toEqual(['Moj', 'Do wysylki', 'Reklamacje']);
    expect(new Set(merged.tiles.map((t) => t.id)).size).toBe(3);
    expect(merged.groups).toHaveLength(2);
    // zaimportowane kafelki stoja w zaimportowanej grupie
    const imported = merged.tiles[1];
    expect(merged.groups.find((g) => g.id === imported.group)).toBeTruthy();
  });

  it('plik, ktory nie jest zestawem kafelkow, jest odrzucany', () => {
    const cur = emptyConfig(false);
    expect(importConfig('nie json', cur)).toBeNull();
    expect(importConfig('{"a":1}', cur)).toBeNull();
    expect(importConfig(JSON.stringify({ binearTiles: 1, tiles: [] }), cur)).toBeNull();
  });
});
