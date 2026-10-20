import { useLayoutEffect, useRef, type CSSProperties } from 'react';

import { Delta } from './CounterHistory';
import type { DaySnapshot } from './counters';
import { colorCss, groupTotals, shownValue, type CustomTile, type TileGroup, type TileNumbers } from './customTiles';
import { PenIcon } from './icons';
import { zadan } from './plural';
import { TILE_ICON_NODES } from './tileIcons';

export { TILE_ICON_NODES };
export const tileColorCss = colorCss;

/**
 * Wlasne kafelki uzytkownika: grupy z podpisami, w nich kafelki z liczba zadan albo suma SP. Klik
 * stosuje zapisany widok (zakres + filtry); ponowny klik czysci filtry. Podpis grupy pokazuje, jak w zestawie
 * IT, SUME kafelkow (zadania i SP) z roznica wzgledem poprzedniego dnia. Wyglad bierzemy z tych samych klas
 * co wbudowane liczniki, zeby oba rzedy wygladaly jak jedna rodzina.
 */
export function TilesBar({
  groups,
  values,
  prev,
  activeId,
  pending,
  onPick,
  onManage,
  onDefaults,
}: {
  groups: { group: TileGroup; tiles: CustomTile[] }[];
  values: ReadonlyMap<string, TileNumbers>;
  /** Ostatni zapisany dzien przed dzisiejszym (dla strzalek); `null`, gdy nie ma historii. */
  prev: { day: string; snap: DaySnapshot } | null;
  activeId: string | null;
  /** Kafelki, ktorych liczba jeszcze sie liczy (SP albo czaty nie doszly) — „…" zamiast liczby, bez strzalki. */
  pending: ReadonlySet<string>;
  onPick: (tile: CustomTile) => void;
  onManage: () => void;
  /** Wczytuje domyslny zestaw kafelkow; przycisk tylko przy pustym pasku. */
  onDefaults: () => void;
}) {
  /*
   * Olowek to kwadrat o wysokosci kafelkow, a ta zalezy od tresci (strzalka „od wczoraj" dodaje
   * linie). CSS nie umie wziac szerokosci z wysokosci tak, zeby pasek ja uwzglednil, wiec mierzymy rzad, w ktorym
   * stoi olowek (ma wysokosc kafelkow), i ustawiamy bok kwadratu. Bok nie zmienia wysokosci rzedu — bez petli.
   */
  const pen = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const el = pen.current;
    const row = el?.parentElement;
    if (!el || !row) return;
    const fit = () => {
      const side = `${Math.round(row.offsetHeight)}px`;
      el.style.width = side;
      el.style.height = side;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(row);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="counters counters-custom" role="toolbar" aria-label="Moje kafelki">
      {groups.map(({ group, tiles }) => {
        const total = groupTotals(tiles, values);
        const groupPending = tiles.some((t) => pending.has(t.id));
        const prevCount = prev?.snap[`g:${group.id}`];
        const prevPoints = prev?.snap[`gs:${group.id}`];
        const caption = group.hideCaption ? null : (
            <span
              className="counters-cap counters-cap-total counters-cap-static"
              title={
                `Różnych zadań w grupie: ${zadan(total.count)}, ${total.points} SP.` +
                (prevPoints !== undefined ? ` Dzień wcześniej: ${prevCount === undefined ? '?' : zadan(prevCount)}, ${prevPoints} SP.` : '') +
                ' To samo zadanie z kilku kafelków liczy się raz.'
              }
            >
              <span className="counters-cap-text">{group.name}</span>
              <span className="counters-cap-count">{groupPending ? '…' : total.count}</span>
              <span className="counters-cap-sp">{groupPending ? '' : `${total.points} SP`}</span>
              {prev && !groupPending && <Delta now={total.count} before={prevCount} day={prev.day} riseIsBad />}
            </span>
          );
        return (
          <div key={group.id} className="counters-group" style={{ ['--n' as string]: tiles.length } as CSSProperties}>
            {caption ?? (
              /* Grupa bez podpisu: niewidoczny odpowiednik trzyma kafelki na wysokosci sasiednich grup. */
              <span className="counters-cap counters-cap-total counters-cap-static counters-cap-ghost" aria-hidden>
                <span className="counters-cap-text">&nbsp;</span>
                <span className="counters-cap-count">0</span>
                <span className="counters-cap-sp">0 SP</span>
              </span>
            )}
            <div className="counters-group-row">
              {tiles.map((t) => {
                const on = activeId === t.id;
                const v = values.get(t.id) ?? { count: 0, points: 0 };
                const shown = shownValue(t, v);
                const wait = pending.has(t.id);
                return (
                  <button
                    key={t.id}
                    className={`counter${on ? ' counter-on' : ''}`}
                    style={{ ['--c' as string]: colorCss(t.color) } as CSSProperties}
                    aria-pressed={on}
                    title={on ? 'Kliknij ponownie, żeby wyczyścić filtry.' : `Pokaż: ${t.name}`}
                    onClick={() => onPick(t)}
                  >
                    <span className="counter-icon">{TILE_ICON_NODES[t.icon] ?? TILE_ICON_NODES.list}</span>
                    <span className="counter-body">
                      <span className="counter-top">
                        <span className="counter-value" title={wait ? 'Liczę — dane jeszcze dochodzą' : undefined}>
                          {wait ? '…' : shown}
                        </span>
                        {t.measure === 'points' && <span className="counter-points">SP</span>}
                        {/* Druga miara mniejszym tekstem: kafelek liczy zadania -> obok SP, i odwrotnie. */}
                        {!wait && (
                          <span className="counter-points counter-second">
                            {t.measure === 'points' ? `${v.count} zad.` : `${v.points} SP`}
                          </span>
                        )}
                      </span>
                      <span className="counter-label">{t.name}</span>
                      {prev && !wait && <Delta now={shown} before={prev.snap[`t:${t.id}`]} day={prev.day} riseIsBad />}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      {/* Pusty pasek (nowa instalacja albo przejscie z wbudowanych licznikow): jednym klikiem domyslny zestaw. */}
      {!groups.length && (
        <div className="counters-group counters-tools">
          <div className="counters-group-row counters-tools-row">
            <button className="counter counter-add tiles-defaults" onClick={onDefaults} title="Zestaw procesu IT zapisany w repo">
              Wczytaj domyślne kafelki
            </button>
          </div>
        </div>
      )}
      <div className="counters-group counters-tools counters-tools-edit">
        {/* Przy kafelkach niewidoczny odpowiednik podpisu grupy: olowek staje na wysokosci kafelkow, a nie od linii
            podpisow (wygladal wtedy na wyzszy od nich). Na pustym pasku podpisow nie ma, wiec i odstepu nie trzeba. */}
        {groups.length > 0 && (
          <span className="counters-cap counters-cap-total counters-cap-static counters-cap-ghost" aria-hidden>
            <span className="counters-cap-text">&nbsp;</span>
            <span className="counters-cap-count">0</span>
            <span className="counters-cap-sp">0 SP</span>
          </span>
        )}
        <div className="counters-group-row counters-tools-row">
          <button
            ref={pen}
            className="counter counter-add counter-icon-only"
            onClick={onManage}
            title="Kafelki: dodaj bieżący widok, kolejność, grupy, kolory, eksport i import"
            aria-label="Edytuj kafelki"
          >
            <PenIcon />
          </button>
        </div>
      </div>
    </div>
  );
}
