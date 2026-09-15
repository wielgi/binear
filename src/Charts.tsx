/*
 * Wykres spalania sprintu.
 *
 * Rysowany recznie w SVG, bez biblioteki. Powod jest prosty: to wykres o znanym
 * ksztalcie, a kazda biblioteka przynosi wlasna typografie, wlasne kolory
 * i wlasne tooltipy — czyli dokladnie te trzy rzeczy, ktore w tej aplikacji sa
 * ustawione tokenami i maja wygladac tak samo wszedzie.
 *
 * Kolory: JEDNA seria (caly zespol albo jedna osoba) dostaje --accent, zgodnie
 * z zasada arkusza „jeden akcent". Przy porownywaniu KILKU osob naraz kolor
 * przestaje byc ozdoba i staje sie jedynym sposobem odroznienia linii — wtedy
 * kazda osoba dostaje wlasna barwe z `tagHue`, tak samo jak tagi i epiki.
 */

import { useCallback, useRef, useState } from 'react';
import type { BurndownPoint, ScopeSegment } from './sprintStats';
import { WORK_END_HOUR, WORK_START_HOUR } from './bitrix';

/**
 * Gorna krawedz osi Y — najblizszy okragly stopien POWYZEJ najwyzszej wartosci.
 *
 * Drabinka musi byc gesta: przy samych 1/2/5 wykres na 225 SP dostaje os do 500
 * i polowa pola zostaje pusta. Kroki co pol rzedu trzymaja slupki wysokie, a
 * podzialka nadal wypada na liczbach, ktore da sie przeczytac.
 */
function niceMax(value: number): number {
  if (value <= 0) return 10;
  const pow = 10 ** Math.floor(Math.log10(value));
  const n = value / pow;
  const step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((c) => n <= c) ?? 10;
  return step * pow;
}

/**
 * Podzialka: 4 rowne kroki od zera do gory osi, BEZ powtorzen.
 *
 * Przy malej gornej krawedzi zaokraglenie sklejalo stopnie — `ticks(1)` dawalo
 * [0,0,1,1,1], czyli pokrywajace sie linie i powtorzone klucze Reacta. Zdarza sie
 * naprawde: wystarczy wybrac osobe, ktorej zadania nie maja oszacowan.
 */
function ticks(max: number): number[] {
  return [...new Set([0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f)))];
}

/*
 * Wysokosc jest STALA, szerokosc bierze sie z pomiaru kontenera.
 *
 * Wykres w SVG o sztywnym `viewBox` skaluje sie w CALOSCI: rozciagniety na
 * szeroki ekran rosnie tez w pionie, a razem z nim podpisy osi — 11px robi sie
 * naglowkiem. Ratowanie tego `max-width` dzialalo, ale zostawialo pol wiersza
 * pustego. Zamiast tego dopasowujemy uklad wspolrzednych do PIKSELI: viewBox ma
 * dokladnie tyle jednostek, ile kontener ma pikseli, wiec nic sie nie skaluje —
 * wykres jest szeroki, a typografia zostaje taka, jak w reszcie aplikacji.
 */
/*
 * Podzialka godzinowa na osi — proba. Siedem kresek na dzien (8:00–16:00).
 * Jedna stala, zeby dalo sie to obejrzec i zdjac bez grzebania w sciezce SVG.
 */
const HOUR_TICKS = true;

const H = 280;
const PAD = { top: 16, right: 16, bottom: 42, left: 44 };
const MIN_W = 320;

/**
 * Szerokosc kontenera. ResizeObserver, bo panel boczny i zwijanie grup zmieniaja
 * ja bez zdarzenia `resize` okna.
 *
 * Ref jest FUNKCYJNY, nie `useRef` + `useEffect`. Komponent ma wczesny `return`
 * dla sprintu bez dni roboczych — a wtedy element z refem w ogole sie nie renderuje.
 * Efekt z pusta lista zaleznosci odpalilby sie raz, na pustym refie, i nigdy juz
 * nie podpial obserwatora, kiedy wykres faktycznie sie pojawil. Callback ref
 * podpina sie dokladnie wtedy, gdy wezel wchodzi do drzewa.
 */
function useWidth(): [(el: HTMLDivElement | null) => void, number] {
  const [w, setW] = useState(760);
  const ro = useRef<ResizeObserver | null>(null);

  const ref = useCallback((el: HTMLDivElement | null) => {
    ro.current?.disconnect();
    if (!el) return;
    setW(Math.max(MIN_W, el.getBoundingClientRect().width));
    ro.current = new ResizeObserver(([e]) => setW(Math.max(MIN_W, e.contentRect.width)));
    ro.current.observe(el);
  }, []);

  return [ref, w];
}

/** Tlo wykresu: linie podzialki i podpisy osi Y. */
function Grid({ max, w }: { max: number; w: number }) {
  const plotH = H - PAD.top - PAD.bottom;
  return (
    <g className="chart-grid">
      {ticks(max).map((t) => {
        const y = PAD.top + plotH - (t / max) * plotH;
        return (
          <g key={t}>
            <line x1={PAD.left} x2={w - PAD.right} y1={y} y2={y} />
            <text x={PAD.left - 10} y={y + 4} textAnchor="end">
              {t}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** Jedna linia wykresu: caly zespol albo jedna osoba. */
export interface Series {
  key: string;
  label: string;
  color: string;
  points: BurndownPoint[];
}

/**
 * Przechyl liczby "plan" ku zieleni albo czerwieni: zieleni, gdy zostalo MNIEJ
 * niz przewiduje plan (idziemy szybciej), czerwieni, gdy wiecej.
 *
 * To nie jest kolor sam w sobie, tylko DOCIAGNIECIE szarosci — mieszamy
 * `--fg-dim` z przygaszonym odcieniem, wiec punktem wyjscia w kazdym motywie
 * zostaje jego wlasna szarosc, a liczba nigdy nie krzyczy glosniej niz linie,
 * ktore opisuje. Odcien i nasycenie jak u osob (52%/55%), nie czysty zielony.
 *
 * Miara to odchylka w stosunku do CALEGO zakresu serii, nie do planu na dany
 * dzien. Pod koniec sprintu plan schodzi do zera i przy nim kazda roznica byla
 * by procentowo ogromna — jedno zalegle zadanie swiecilo by wtedy na pelna
 * czerwien. Pelny przechyl nalezy sie dopiero roznicy rzedu 20% zakresu.
 */
/**
 * Liczba planu do ODCZYTANIA — calkowita, gdy wypada calkowita, inaczej z jednym
 * miejscem po przecinku.
 *
 * Zaokraglanie w gore do calosci klamalo: linia idealna wypadala w Dniu 1 na
 * 14,4, rzeczywista na 14,0, a podpis mowil przy obu „14". Widac bylo, ze linie
 * sie rozchodza, i nie bylo z czego tego wyczytac. Story pointy sa calkowite,
 * ale PROJEKCJA calkowita byc nie musi.
 */
function planLabel(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1).replace('.', ',');
}

function paceFill(actual: number, plan: number, scope: number): string {
  const gap = plan - actual; // dodatni = zostalo mniej niz w planie, czyli szybciej
  const t = Math.min(1, Math.abs(gap) / Math.max(scope * 0.2, 1));
  // Ponizej progu roznica jest szumem, a ledwo widoczny przechyl czytalby sie
  // jak brud na tekscie, nie jak informacja.
  if (t < 0.05) return 'var(--fg-dim)';
  return `color-mix(in oklab, hsl(${gap > 0 ? 145 : 5} 52% 55%) ${Math.round(t * 65)}%, var(--fg-dim))`;
}

export function BurndownChart({ series }: { series: Series[] }) {
  // Hooki musza stac PRZED jakimkolwiek `return` — inaczej przy sprincie bez dni
  // roboczych React dostaje inna liczbe hookow niz przy pelnym i wywala liste.
  const [ref, W] = useWidth();
  /*
   * Pozycja kursora na osi X jako UŁAMKOWY indeks dnia (2.4 = 40% drogi z dnia 2
   * do dnia 3), nie zaokraglony do najblizszego punktu. Prowadnica chodzi wtedy
   * plynnie, a nie skokami co kolumne.
   */
  const [hover, setHover] = useState<number | null>(null);
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  // Wszystkie serie dziela te sama os X (ten sam sprint), wiec dni bierzemy z pierwszej.
  const days = series[0]?.points ?? [];

  /*
   * Linia idealna ma sens tylko przy JEDNEJ serii. Przy kilku osobach kazda ma
   * wlasny zakres, wiec albo trzeba by rysowac kilka linii odniesienia (wykres
   * robi sie krata), albo jedna wspolna, ktora dla nikogo nie jest prawdziwa.
   * Porownujac ludzi patrzy sie na KSZTALT linii, nie na dystans do planu.
   */
  const solo = series.length === 1;



  // Linie odniesienia licza sie do sufitu osi tak samo jak dane — inaczej przy
  // kimś, kto jest mocno przed planem, projekcja wychodzilaby poza kadr.
  const top = Math.max(
    1,
    ...series.flatMap((s) => s.points.map((p) => Math.max(p.ideal, p.actual ?? 0))),
  );
  const max = niceMax(top);
  const x = (i: number) => PAD.left + (i / Math.max(1, days.length - 1)) * plotW;
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;

  if (days.length < 2)
    return <div className="chart-empty">Sprint nie ma jeszcze dni roboczych.</div>;

  /*
   * Linia rzeczywista urywa sie na dzis — dni z przyszlosci nie maja stanu. Indeks
   * niesiemy razem z punktem, bo pozycja na osi X liczy sie z PELNEJ listy dni:
   * po odfiltrowaniu przyszlosci linia rozjechalaby sie wzgledem idealnej.
   */
  /*
   * Ile DNIA ROBOCZEGO juz minelo (0…1). Dzien pracy to 8:00–16:00 — te same
   * godziny, ktorymi `clampWorkingMs` przycina czas w statusie.
   *
   * Po co: punkt „dzisiaj" siedzi na kresce swojego dnia, czyli tam, gdzie dzien
   * sie KONCZY. O dziesiatej rano wyglada to tak, jakby caly dzien juz minal, a
   * linia nie ma szans nadazyc za planem, ktory liczy sie do konca doby. Punkt
   * przesuwa sie wiec plynnie miedzy kreskami razem z zegarem.
   */
  const dayProgress = (at: number) => {
    const end = new Date(at);
    const now = new Date();
    const sameDay =
      end.getFullYear() === now.getFullYear() &&
      end.getMonth() === now.getMonth() &&
      end.getDate() === now.getDate();
    /* Dzien z przeszlosci jest zamkniety — punkt stoi na swojej kresce. */
    if (!sameDay) return 1;
    const mins = now.getHours() * 60 + now.getMinutes();
    const from = WORK_START_HOUR * 60;
    const to = WORK_END_HOUR * 60;
    return Math.min(1, Math.max(0, (mins - from) / (to - from)));
  };

  const drawn = series.map((s) => {
    const real = s.points.map((p, i) => ({ p, i })).filter(({ p }) => p.actual !== null);
    return { s, real, last: real[real.length - 1] };
  });

  /*
   * Pozycja pozioma punktu. Ostatni punkt serii — ten z DZISIAJ — nie siada na
   * kresce swojego dnia, tylko tyle przed nia, ile dnia roboczego jeszcze zostalo.
   * Reszta punktow to dni domkniete i stoja dokladnie na kreskach.
   */
  const px = (i: number, isLast: boolean) => {
    if (!isLast || i === 0) return x(i);
    const f = dayProgress(days[i]?.at ?? 0);
    return x(i - (1 - f));
  };

  const lerp = (a: number, b: number, f: number) => a + (b - a) * f;

  /** Data pod podpisem dnia — dzien i miesiac wystarcza, rok bierze sie z kontekstu. */
  const dayDate = (at: number) => {
    const d = new Date(at);
    return Number.isNaN(d.getTime())
      ? ''
      : `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
  };

  /*
   * Odczyt pod kursorem liczymy RAZ i uzywamy w dwoch miejscach: kropki rysuje
   * SVG, a liste wartosci — zwykly div nad wykresem. Tekst w SVG nie ma tla ani
   * ukladu, wiec przy kilku osobach nachodzil na siatke i na same linie; w HTML
   * dostaje karte, odstepy i sortowanie za darmo.
   */
  const tip = (() => {
    if (hover === null || days.length < 2) return null;
    const lo = Math.floor(hover);
    const hi = Math.min(days.length - 1, lo + 1);
    const f = hover - lo;
    /*
     * Ostatni dzien, ktory NAPRAWDE ma stan — tam urywa sie linia rzeczywista.
     * Na prawo od niego nie ma czego mierzyc, wiec panel podaje SAM PLAN.
     *
     * Bez tego progu odczyt ciagnal ostatnia znana wartosc dalej: `b.actual` dnia
     * przyszlego jest `null`, wiec brano `a.actual` z dnia dzisiejszego i „88 SP"
     * szlo plasko az do nastepnego dnia. Liczba dzisiejsza rozciagnieta na jutro
     * to prognoza udajaca pomiar.
     *
     * Prowadnica chodzi dalej PLYNNIE za kursorem, tak jak zawsze — zmienia sie
     * tylko to, ze za dniem dzisiejszym nie ma juz czego pokazac poza planem.
     */
    let lastReal = -1;
    for (const s of series) {
      s.points.forEach((p, i) => {
        if (p.actual !== null && i > lastReal) lastReal = i;
      });
    }
    const beyond = hover > lastReal;

    const all = series.map((s) => {
      const a = s.points[lo];
      const b = s.points[hi];
      const v =
        a.actual === null ? null : b.actual === null ? a.actual : lerp(a.actual, b.actual, f);
      // Projekcja KAZDEJ osoby z osobna — wspolny plan nie istnieje, bo kazda
      // ma inny zakres. Bez tego przy porownaniu widac "ile zostalo", ale nie
      // wiadomo, czy to duzo, czy malo jak na jej wlasny plan.
      return { s, v, plan: lerp(a.ideal, b.ideal, f) };
    });

    const rows = beyond
      ? []
      : all
          .filter((r): r is { s: Series; v: number; plan: number } => r.v !== null)
          // Kolejnosc jak na wykresie: najwyzsza linia u gory listy. Bez tego przy
          // kilku osobach trzeba wodzic wzrokiem miedzy kolorami, zeby je sparowac.
          .sort((a, b) => b.v - a.v);

    return {
      x: x(hover),
      label: f < 0.5 ? days[lo].label : days[hi].label,
      /*
       * Plan trzymamy DOKLADNY — jedna wartosc rysuje kropke na linii idealnej
       * i ta sama trafia do podpisu (przez `planLabel`).
       *
       * Byly tu dwie: zaokraglona do napisu i dokladna do kropki. Rozjezdzaly
       * sie w obie strony — najpierw kropka skakala schodkami co cale SP, potem
       * podpis mowil „plan 14" przy linii stojacej na 14,4 i nie dalo sie
       * wyczytac, czemu linie sie rozchodza.
       */
      planAt: lerp(days[lo].ideal, days[hi].ideal, f),
      rows,
      /*
       * Odcinek, ktory JESZCZE NIE NADSZEDL.
       *
       * Nie wolno go pokazac jako „0 SP": zero znaczy „wszystko spalone", wiec
       * wykres chwalilby zespol za dni, ktore dopiero nadejda (i barwil liczbe
       * planu na zielono, bo 0 jest zawsze przed planem). O przyszlosci wiemy
       * dokladnie jedno — gdzie bieglaby linia idealna.
       */
      future: rows.length === 0,
      /** Plan kazdej serii z osobna — do odcinka, ktory jeszcze nie nadszedl. */
      plans: all.map((r) => ({ s: r.s, plan: r.plan })),
    };
  })();

  return (
    <div className="chart-box" ref={ref}>
      <svg
        className="chart"
        width="100%"
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Wykres spalania sprintu"
        onMouseMove={(e) => {
          /*
           * Odczyt chodzi za kursorem po CALEJ szerokosci, nie po samych kropkach:
           * trafianie w punkt o promieniu 3px jest bez sensu, a natywny <title>
           * pojawia sie z sekundowym opoznieniem. Uklad wspolrzednych jest 1:1
           * z pikselami, wiec to zwykle odejmowanie.
           */
          const rect = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * W;
          const i = ((px - PAD.left) / plotW) * (days.length - 1);
          setHover(Math.min(days.length - 1, Math.max(0, i)));
        }}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="burn-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>

        <Grid max={max} w={W} />

        {/* Pole pod linia i linia idealna TYLKO przy jednej serii: kilka
            nachodzacych wypelnien zlewa sie w papke i nie da sie ich odczytac. */}
        {solo && drawn[0].last && (
          <polygon
            className="area-real"
            fill="url(#burn-fill)"
            points={
              `${drawn[0].real
                .map(({ p, i }) => `${px(i, i === drawn[0].last.i)},${y(p.actual as number)}`)
                .join(' ')} ` + `${px(drawn[0].last.i, true)},${y(0)} ${x(0)},${y(0)}`
            }
          />
        )}

        {/*
          Projekcja — rowny zjazd od zakresu do zera. Przy jednej serii to znajoma
          szara kreska. Przy kilku osobach kazda dostaje WLASNA, w swoim kolorze
          i mocno przygaszona: inaczej nie wiadomo, czyja jest, a w pelnej sile
          szesc linii odniesienia zamienia wykres w krate.
        */}
        {solo ? (
          <polyline
            className="line-ideal"
            points={series[0].points.map((p, i) => `${x(i)},${y(p.ideal)}`).join(' ')}
          />
        ) : (
          series.map((s) => (
            <polyline
              key={`plan-${s.key}`}
              className="line-plan"
              style={{ stroke: s.color }}
              points={s.points.map((p, i) => `${x(i)},${y(p.ideal)}`).join(' ')}
            />
          ))
        )}

        {drawn.map(({ s, real, last }) => (
          <g key={s.key}>
            <polyline
              className="line-real"
              style={{ stroke: s.color }}
              points={real
                .map(({ p, i }) => `${px(i, i === last?.i)},${y(p.actual as number)}`)
                .join(' ')}
            />

            {/* Punkty posrednie sa drobne i wypelnione tlem karty, zeby linia ich
                nie przecinala; DZIS dostaje pelna kropke. */}
            {real.map(({ p, i }) => {
              const isNow = last && i === last.i;
              return (
                <circle
                  key={`${s.key}-${p.label}`}
                  className={isNow ? 'dot-now' : 'dot-real'}
                  style={isNow ? { fill: s.color } : { stroke: s.color }}
                  cx={px(i, Boolean(isNow))}
                  cy={y(p.actual as number)}
                  r={isNow ? 4.5 : 3}
                >
                  <title>{`${s.label} · ${p.label}: ${p.actual} SP pozostało`}</title>
                </circle>
              );
            })}

            {/* Wartosc przy koncu linii tylko przy jednej serii — przy kilku
                podpisy nachodzilyby na siebie, tam liczby daje odczyt hover. */}
            {solo && last && hover === null && (
              <text
                className="dot-label"
                x={px(last.i, true) - 10}
                y={y(last.p.actual as number) - 10}
                textAnchor="end"
              >
                {last.p.actual} SP
              </text>
            )}
          </g>
        ))}

        {tip &&
          (() => {
            // Podpis ucieka na lewo przy prawej krawedzi, zeby nie wyszedl poza kadr.
            const flip = tip.x > W - 240;
            const tx = flip ? tip.x - 10 : tip.x + 10;
            const anchor = flip ? 'end' : 'start';
            return (
              <g className="chart-hover" pointerEvents="none">
                <line
                  className="hover-guide"
                  x1={tip.x}
                  x2={tip.x}
                  y1={PAD.top}
                  y2={PAD.top + plotH}
                />
                {solo && <circle className="dot-ideal" cx={tip.x} cy={y(tip.planAt)} r={3} />}
                {tip.rows.map(({ s, v }) => (
                  <circle
                    key={s.key}
                    className="dot-now"
                    style={{ fill: s.color }}
                    cx={tip.x}
                    cy={y(v)}
                    r={4.5}
                  />
                ))}

                {tip.future ? (
                  /* Przyszlosc: sam plan, bez stanu i bez oceny tempa. Nie ma
                     czego porownac, wiec liczba zostaje w kolorze neutralnym. */
                  <>
                    <text className="hover-label" x={tx} y={PAD.top + 16} textAnchor={anchor}>
                      {tip.label}
                      {solo && (
                        <tspan className="hover-plan" dx="6">
                          plan {planLabel(tip.planAt)}
                        </tspan>
                      )}
                    </text>
                    {/* Przy kilku osobach wspolnego planu nie ma — kazda ma wlasny
                        zakres, wiec kazda dostaje wlasny wiersz. */}
                    {!solo &&
                      tip.plans.map(({ s, plan }, k) => (
                        <text
                          key={s.key}
                          className="hover-plan"
                          x={tx}
                          y={PAD.top + 36 + k * 18}
                          textAnchor={anchor}
                        >
                          {s.label} · plan {planLabel(plan)}
                        </text>
                      ))}
                  </>
                ) : solo ? (
                  <text className="hover-label" x={tx} y={PAD.top + 16} textAnchor={anchor}>
                    {tip.label}
                    <tspan className="hover-value" dx="6">
                      {Math.round(tip.rows[0].v)} SP
                    </tspan>
                    <tspan
                      className="hover-plan"
                      dx="6"
                      style={{ fill: paceFill(tip.rows[0].v, tip.planAt, days[0]?.ideal ?? 0) }}
                    >
                      plan {planLabel(tip.planAt)}
                    </tspan>
                  </text>
                ) : (
                  <>
                    <text className="hover-label" x={tx} y={PAD.top + 16} textAnchor={anchor}>
                      {tip.label}
                    </text>
                    {/* Wiersz na osobe, posortowane malejaco — kolejnosc podpisow
                        odpowiada wtedy kolejnosci linii na wykresie. */}
                    {tip.rows.map(({ s, v, plan }, k) => (
                      <text
                        key={s.key}
                        className="hover-value"
                        style={{ fill: s.color }}
                        x={tx}
                        y={PAD.top + 36 + k * 18}
                        textAnchor={anchor}
                      >
                        {s.label} · {Math.round(v)} SP
                        {/* Zakres liczymy z WLASNEJ serii — przy wspolnym kazdy,
                            kto ma malo pointow, zostawalby na zawsze szary. */}
                        <tspan
                          className="hover-plan"
                          dx="6"
                          style={{ fill: paceFill(v, plan, s.points[0]?.ideal ?? 0) }}
                        >
                          plan {planLabel(plan)}
                        </tspan>
                      </text>
                    ))}
                  </>
                )}
              </g>
            );
          })()}

        {/*
          Podpis dnia stoi POSRODKU swojego odcinka, nie na kresce.
          Kreska oznacza moment, w ktorym dzien SIE KONCZY — podpisany „Dzień 1"
          sugerowal, ze dzien 1 wlasnie tam sie zaczyna, a on wtedy wlasnie mija.
          Dzien 1 to odcinek miedzy „Planowanie" a pierwsza kreska, wiec tam
          nalezy jego nazwa. „Planowanie" zostaje na kresce, bo to punkt w czasie
          (start sprintu), a nie odcinek.

          Data POD podpisem, w drugiej linijce: jedna dluga etykieta („Dzień 1 ·
          31.08") zlewa sie z sasiadami przy waskim wykresie.
        */}
        {days.map((p, i) => {
          const at = i === 0 ? x(0) : x(i - 0.5);
          return (
            <g key={p.label}>
              {/*
                Kreska zakresu pod odcinkiem dnia. Sam wysrodkowany podpis mowi
                „gdzies tutaj"; ta kreska mowi DOKAD dzien siega — od granicy do
                granicy. Przy „Planowanie" jej nie ma, bo to punkt, nie odcinek.
              */}
              {i > 0 && (
                <>
                  {/*
                    Klamra + strzalka i podzialka godzinowa to OSOBNE sciezki,
                    bo niosa co innego: pierwsza mowi „dokad siega dzien" i musi
                    byc czytelna, druga to tylko podzialka i ma zostac w tle.
                    Jedna sciezka znaczylaby jeden kolor dla obu.
                  */}
                  <path
                    className="chart-span"
                    d={(() => {
                      const y0 = PAD.top + plotH + 5;
                      const a2 = x(i - 1) + 3;
                      const b2 = x(i) - 3;
                      return `M${a2} ${y0}v5h${b2 - a2}v-5M${at} ${y0 + 5}v3m-2.5-2.5l2.5 2.5l2.5-2.5`;
                    })()}
                  />
                  {HOUR_TICKS &&
                    /*
                     * Podzialka godzinowa w DWOCH sciezkach: drobne godziny i te
                     * co dwie. Jedna sciezka znaczy jedna grubosc, a te wazniejsze
                     * maja byc nie tylko dluzsze, ale i grubsze — inaczej przy
                     * szesciu kreskach obok siebie roznica dlugosci sama nie
                     * wystarcza, zeby oko je rozdzielilo.
                     */
                    (
                      [
                        ['chart-hours', false],
                        ['chart-hours-major', true],
                      ] as const
                    ).map(([cls, major]) => {
                      const d = Array.from(
                        { length: WORK_END_HOUR - WORK_START_HOUR - 1 },
                        (_, k) => {
                          const h = WORK_START_HOUR + k + 1;
                          const mid = (WORK_START_HOUR + WORK_END_HOUR) / 2;
                          const isMajor = h === mid || (h - WORK_START_HOUR) % 2 === 0;
                          if (isMajor !== major) return '';
                          const f = (k + 1) / (WORK_END_HOUR - WORK_START_HOUR);
                          const len = h === mid ? 6 : major ? 5 : 3;
                          return `M${x(i - 1 + f)} ${PAD.top + plotH + 10}v-${len}`;
                        },
                      ).join('');
                      return d ? <path key={cls} className={cls} d={d} /> : null;
                    })}
                </>
              )}
              <text className="chart-x" x={at} y={H - 20} textAnchor="middle">
                {p.label}
              </text>
              <text className="chart-date" x={at} y={H - 7} textAnchor="middle">
                {dayDate(p.at)}
              </text>
            </g>
          );
        })}
      </svg>

    </div>
  );
}

/**
 * Slupek zakresu sprintu — z czego skladaja sie story pointy TERAZ.
 *
 * PIONOWY i przy lewej krawedzi, na cala wysokosc wykresu: stoi obok spalania,
 * wiec czyta sie go jednym spojrzeniem razem z linia — „tyle zostalo" i „tak to
 * jest rozlozone" w tej samej wysokosci ekranu. Poziomy pasek nad wykresem
 * zabieral osobny wiersz i rozjezdzal sie z osia.
 *
 * Jeden slupek, nie dwa. „Zaplanowane obok zrobionego" wymagaloby podpisania go
 * suma, a suma kawalkow (caly zakres sprintu) to nie to samo co „Zaplanowane"
 * nad wykresem: tamta liczba odejmuje prace domknieta jeszcze przed startem
 * sprintu. Dwie prawdziwe, ale rozne liczby jedna pod druga czytalyby sie jak
 * blad. Slupek jest wiec KOMPOZYCJA — cala wysokosc to caly zakres, a udzial
 * kolumny FINISH sam pokazuje, ile z tego jest zrobione.
 *
 * Liczby stoja OBOK slupka, nie na nim. Kolory kolumn ustawia zespol w Bitriksie
 * i bywaja jasne (zolty, jasnozielony) — bialy tekst na nich znikal, a czarny
 * znikalby na ciemnych. Zaden jeden kolor tekstu nie dziala na wszystkich, wiec
 * tekst schodzi z kolorowego tla na tlo karty, gdzie kontrast jest znany.
 */
export function ScopeBar({
  segments,
  /** Story pointy uznane za zrobione — TA SAMA definicja, co liczby nad wykresem. */
  done,
}: {
  segments: ScopeSegment[];
  done: number;
}) {
  const total = segments.reduce((a, s) => a + s.sp, 0);
  // Sprint bez oszacowan nie ma czego dzielic. Przelaczanie sie wtedy po cichu na
  // LICZBE zadan podmienialoby jednostke pod tym samym slupkiem — lepiej nic.
  if (total <= 0) return null;

  const hue = (c: string | null) => (c ? `#${c}` : 'var(--fg-dim)');

  /*
   * Podpis mieści sie dopiero od pewnej wysokosci kawalka. Prog liczymy w PIKSELACH,
   * nie w procentach: jeden wiersz 11px potrzebuje okolo 16px z marginesem, czyli
   * przy 280px slupka jakies 6% zakresu. Nizsze kawalki zostaja same kolorem —
   * ich liczbe podaje podpowiedz.
   */
  const FITS = 16 / SCOPE_H;

  return (
    <div className="scope">
      <div className="scope-bar">
        {/*
          GOTOWE zaznaczamy na tym samym slupku, nie osobnym paskiem obok.

          Robimy to od drugiej strony: przygaszamy to, co jeszcze NIE jest zrobione.
          Dolna czesc zostaje wiec w pelnym kolorze i sama rzuca sie w oczy jako
          wynik, a kolory kolumn nadal sa czytelne pod welonem. Sama kreska tego
          nie robila — 2 px miedzy jaskrawymi pasami czytalo sie jak szpara
          miedzy kolumnami, a nie jak granica.

          Wysokosc bierze sie z tej samej definicji, co „Zakończone" nad wykresem
          i co zjazd linii obok — jedna wielkosc, trzy miejsca.
        */}
        {done < total && (
          <div
            className="scope-pending"
            style={{ bottom: `${(done / total) * 100}%` }}
            title={`Jeszcze nie zrobione: ${total - done} SP`}
          />
        )}
        {segments.map((s) => (
          <div
            key={s.id}
            className="scope-seg"
            /* Proporcja z `flex-grow` przy zerowej bazie — procenty wymagalyby
               zaokraglen, ktore przy kilkunastu kawalkach zostawiaja szpare. */
            style={{ flex: `${s.sp} 1 0`, background: hue(s.color) }}
            title={`${s.name} — ${s.sp} SP · ${s.count} ${plural(s.count)}`}
          />
        ))}
      </div>

      {/*
        Granica gotowosci stoi POZA slupkiem, nie w srodku: slupek ma
        `overflow: hidden`, wiec kreska w nim moglaby konczyc sie najwyzej rowno
        z jego krawedzia i czytala sie jak szpara miedzy kolumnami. Wypuszczona
        na boki wyglada jak znacznik na skali — czyli to, czym jest.
      */}
      {done > 0 && done < total && (
        <div
          className="scope-done"
          style={{ bottom: `${(done / total) * 100}%` }}
          title={`Spalone w tym sprincie: ${done} z ${total} SP`}
        />
      )}

      {/* Druga kolumna o TYCH SAMYCH proporcjach — dzieki temu kazdy podpis stoi
          dokladnie na wysokosci swojego kawalka, bez liczenia pozycji w JS. */}
      <div className="scope-labels">
        {segments.map((s) => (
          <div key={s.id} className="scope-label" style={{ flex: `${s.sp} 1 0` }}>
            {s.sp / total >= FITS && (
              <>
                <span className="scope-label-val">{s.sp} SP</span>
                <span className="scope-label-name" title={s.name}>
                  {s.name}
                </span>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Wysokosc slupka zakresu — rowna wysokosci wykresu spalania (`H`). */
const SCOPE_H = H;

/**
 * Poziomy pasek podzialki na etapy — miniatura duzego slupka, do wiersza osoby.
 *
 * Poziomy, bo stoi w wierszu tabeli i ma sie czytac razem z liczbami obok; duzy
 * slupek jest pionowy, bo stoi przy wykresie i ma jego wysokosc. Ten sam
 * rachunek (`stageBreakdown`), ten sam kolor kolumny — inna orientacja.
 *
 * Bez granicy gotowosci: w 60 px kreska bylaby szumem, a „zrobione / calosc"
 * stoi liczbami tuz obok.
 */
export function StageStrip({ segments, done }: { segments: ScopeSegment[]; done: number }) {
  const total = segments.reduce((a, s) => a + s.sp, 0);
  if (total <= 0) return null;

  /*
   * Pasek jest POZIOMY, wiec „zrobione" lezy po PRAWEJ, a nie u dolu jak
   * w duzym slupku: kolejnosc kawalkow jest ta sama (kolumny tablicy wg `sort`),
   * tylko os inna — pierwsza kolumna po lewej, FINISH na koncu.
   */
  const pending = (1 - done / total) * 100;

  return (
    <span className="stage-strip">
      {/* Ta sama umowa co w duzym slupku: przygaszone = jeszcze nie zrobione. */}
      {done > 0 && <span className="stage-strip-pending" style={{ right: `${100 - pending}%` }} />}
      {done > 0 && done < total && (
        <span className="stage-strip-done" style={{ left: `${pending}%` }} />
      )}
      {segments.map((s) => (
        <span
          key={s.id}
          className="stage-strip-seg"
          style={{ flex: `${s.sp} 1 0`, background: s.color ? `#${s.color}` : 'var(--fg-dim)' }}
          title={`${s.name} — ${s.sp} SP · ${s.count} ${plural(s.count)}`}
        />
      ))}
    </span>
  );
}

/** „zadanie / zadania / zadan" — polska liczba mnoga w podpowiedzi slupka. */
function plural(n: number): string {
  if (n === 1) return 'zadanie';
  const t = n % 10;
  const h = n % 100;
  return t >= 2 && t <= 4 && (h < 12 || h > 14) ? 'zadania' : 'zadań';
}

/** Legenda wykresu — znak plus podpis, ten sam zapis dla kazdej serii. */
export function Legend({ items }: { items: { cls?: string; color?: string; label: string }[] }) {
  return (
    <div className="chart-legend">
      {items.map((it) => (
        <span key={it.label} className="legend-item">
          <span
            className={`legend-mark ${it.cls ?? ''}`}
            style={it.color ? { background: it.color } : undefined}
          />
          {it.label}
        </span>
      ))}
    </div>
  );
}
