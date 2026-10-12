import type { CSSProperties, ReactNode } from 'react';

import {
  BugIcon,
  BulbIcon,
  CalendarIcon,
  CheckIcon,
  CommentIcon,
  EyeIcon,
  FlameIcon,
  HashIcon,
  HistoryIcon,
  LayersIcon,
  ListIcon,
  ParentIcon,
  PenIcon,
  PersonIcon,
  TagIcon,
} from './icons';
import { TILE_COLORS, type CustomTile, type TileGroup } from './customTiles';

/** Ikony do wyboru przy kafelku; klucze musza zgadzac sie z `TILE_ICON_KEYS`. */
export const TILE_ICON_NODES: Record<string, ReactNode> = {
  list: <ListIcon />,
  check: <CheckIcon />,
  pen: <PenIcon />,
  history: <HistoryIcon />,
  comment: <CommentIcon />,
  hash: <HashIcon />,
  calendar: <CalendarIcon />,
  flame: <FlameIcon />,
  bug: <BugIcon />,
  bulb: <BulbIcon />,
  parent: <ParentIcon />,
  layers: <LayersIcon />,
  tag: <TagIcon />,
  person: <PersonIcon />,
  eye: <EyeIcon />,
};

export const tileColorCss = (key: string): string => TILE_COLORS[key]?.css ?? TILE_COLORS.blue.css;

/**
 * Wlasne kafelki uzytkownika: grupy z podpisami, w nich kafelki z liczba zadan albo suma SP. Klik
 * stosuje zapisany widok (zakres + filtry); ponowny klik czysci filtry. Wyglad bierzemy z tych samych
 * klas, co wbudowane liczniki, zeby oba rzedy wygladaly jak jedna rodzina.
 */
export function TilesBar({
  groups,
  values,
  activeId,
  onPick,
  onAdd,
  onManage,
}: {
  groups: { group: TileGroup; tiles: CustomTile[] }[];
  values: ReadonlyMap<string, number>;
  activeId: string | null;
  onPick: (tile: CustomTile) => void;
  onAdd: () => void;
  onManage: () => void;
}) {
  return (
    <div className="counters counters-custom" role="toolbar" aria-label="Moje kafelki">
      {groups.map(({ group, tiles }) => (
        <div key={group.id} className="counters-group" style={{ ['--n' as string]: tiles.length } as CSSProperties}>
          <span className="counters-cap">
            <span className="counters-cap-text">{group.name}</span>
          </span>
          <div className="counters-group-row">
            {tiles.map((t) => {
              const on = activeId === t.id;
              return (
                <button
                  key={t.id}
                  className={`counter${on ? ' counter-on' : ''}`}
                  style={{ ['--c' as string]: tileColorCss(t.color) } as CSSProperties}
                  aria-pressed={on}
                  title={on ? 'Kliknij ponownie, żeby wyczyścić filtry.' : `Pokaż: ${t.name}`}
                  onClick={() => onPick(t)}
                >
                  <span className="counter-icon">{TILE_ICON_NODES[t.icon] ?? TILE_ICON_NODES.list}</span>
                  <span className="counter-body">
                    <span className="counter-top">
                      <span className="counter-value">{values.get(t.id) ?? 0}</span>
                      {t.measure === 'points' && <span className="counter-points">SP</span>}
                    </span>
                    <span className="counter-label">{t.name}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div className="counters-group counters-tools">
        <span className="counters-cap counters-cap-empty" aria-hidden>
          <span className="counters-cap-text">&nbsp;</span>
        </span>
        <div className="counters-group-row">
          <button className="counter counter-add" onClick={onAdd} title="Zapisz bieżący widok (zakres i filtry) jako kafelek">
            ＋ Kafelek
          </button>
          <button className="counter counter-add" onClick={onManage} title="Kolejność, grupy, kolory, eksport i import">
            Kafelki…
          </button>
        </div>
      </div>
    </div>
  );
}
