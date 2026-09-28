/*
 * Widok planowania: rejestr po lewej, sprinty po prawej.
 *
 * Po co osobny widok, skoro lista i tablica juz sa: przy planowaniu patrzy sie
 * na DWA zbiory naraz i przekłada miedzy nimi. Lista pokazuje jeden zakres,
 * tablica jeden sprint — zadne z nich nie odpowiada na pytanie "co jeszcze
 * wziac i czy to sie zmiesci".
 *
 * Trzy rzeczy, ktorych brakowalo w planowaniu Bitriksa i ktore sa tu wprost:
 *
 *  1. LICZBY IDA ZA FILTREM. Zawezenie listy przelicza sumy. U Bitriksa sumy
 *     zostawaly dla calosci, wiec po odfiltrowaniu nie mowily juz o tym, co
 *     widac.
 *  2. OBCIAZENIE OSOB. Sam licznik SP mowi, ze sprint jest pelny; nie mowi,
 *     czyj jest. Pasek osob pokazuje rozklad i zmienia sie przy kazdym
 *     dorzuceniu.
 *  3. GESTY WIERSZE. Wiecej informacji w jednej linii zamiast wielkich kart:
 *     w rejestrze jest ich 175 i przewijanie po dziesiec na ekran to zaden
 *     przeglad.
 *
 * Samego przenoszenia ten plik NIE obsluguje — cele upuszczania rejestruje, ale
 * decyzje podejmuje `onDragEnd` w App.tsx, w jednym wspolnym `DndContext`.
 */

import { Fragment, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDroppable } from '@dnd-kit/core';

import { CLOSED_STATUSES, REVIEW_STATUSES, type Sprint, type Task } from './bitrix';
import { planDropId } from './dnd';
import { BarsIcon, CheckIcon, ChevronIcon, GripIcon, personColor } from './icons';
import { Picker, type Anchor } from './Picker';
import { tagsForWidth } from './taskView';

/*
 * Ile wysokosci prawej kolumny bierze sprint AKTYWNY. Reszta idzie do kolejnego.
 *
 * Nie po polowie: planuje sie GLOWNIE w sprincie aktywnym — to w nim sie czyta,
 * przestawia i skresla — a kolejny jest na razie miejscem odkladczym, czesto
 * pustym. Rowny podzial oddawal polowe ekranu liscie na kilka pozycji i kazal
 * przewijac te, w ktorej naprawde sie pracuje. Suwak i chevron dzialaja dalej,
 * a dwuklik w uchwyt wraca tutaj.
 */
const SPLIT_DEFAULT = 0.8;

/** „zadanie / zadania / zadan" — zeby liczba w naglowku czytala sie po polsku. */
function plural(n: number): string {
  if (n === 1) return 'zadanie';
  const t = n % 10;
  const h = n % 100;
  return t >= 2 && t <= 4 && (h < 12 || h > 14) ? 'zadania' : 'zadań';
}

/** Zwiniete sumy jednego panelu. Liczone ZAWSZE z tego, co panel pokazuje. */
interface PaneStats {
  points: number;
  count: number;
  /** Ile zadan nie ma oszacowania — o tyle `points` jest zanizone. */
  unestimated: number;
  /** Rozklad SP po osobach, malejaco. Nieprzypisane zostaja jako `id: null`. */
  load: { id: number | null; name: string; photo: string | null; points: number }[];
}

function statsOf(
  tasks: Task[],
  people: { id: number; name: string; photo: string | null }[],
): PaneStats {
  const byId = new Map(people.map((p) => [p.id, p]));
  const load = new Map<number | null, { id: number | null; name: string; photo: string | null; points: number }>();

  let points = 0;
  let unestimated = 0;
  for (const t of tasks) {
    const sp = t.storyPoints ?? 0;
    points += sp;
    if (t.storyPoints === null) unestimated += 1;

    /*
     * Nieprzypisane trzymamy jako osobna pozycje, a nie pomijamy: to wlasnie ta
     * czesc sprintu, ktorej nikt nie wzial, i przy planowaniu jest wazniejsza
     * od reszty.
     */
    const id = t.responsibleId;
    const known = id !== null ? byId.get(id) : undefined;
    const key = id ?? null;
    const cur = load.get(key) ?? {
      id: key,
      name: known?.name ?? t.responsibleName ?? (key === null ? 'Nieprzypisane' : `#${key}`),
      photo: known?.photo ?? null,
      points: 0,
    };
    cur.points += sp;
    load.set(key, cur);
  }

  return {
    points,
    count: tasks.length,
    unestimated,
    load: [...load.values()].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name, 'pl')),
  };
}

/**
 * Pasek rozkladu SP po osobach — od razu widac, czy sprint jest wyrownany.
 *
 * Podpis pod kursorem, a nie natywny `title`: ten pokazuje sie z sekundowym
 * opoznieniem i rysuje go system, wiec przy pasku, po ktorym wodzi sie mysza,
 * jest bezuzyteczny. Ten sam wybor i ten sam wyglad co odczyt na wykresie
 * spalania.
 */
function Load({ stats, zawsze }: { stats: PaneStats; zawsze?: boolean }) {
  const [hover, setHover] = useState<{ name: string; points: number; at: number } | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  /*
   * Pusty panel nie dostaje paska — nie ma czego rozkladac. WYJATEK: gdy paski
   * stoja w dwoch wariantach, brak jednego przesuwal wszystko do gory i pary
   * przestawaly sie zgadzac („zaplanowane" mialo jeden pasek, „z przeniesieniem"
   * dwa, choc to te same dwie miary). Wtedy zostaje sam tor — i to tez jest
   * odpowiedz: nikt jeszcze nic nie wzial.
   */
  if (stats.points <= 0 && !zawsze) return null;

  return (
    <div className="plan-load">
      <div
        className="plan-load-bar"
        ref={barRef}
        onMouseLeave={() => setHover(null)}
      >
        {stats.load.map((p) => (
          <span
            key={String(p.id)}
            className="plan-load-seg"
            style={{
              flex: `${p.points} 1 0`,
              /* Nieprzypisane celowo BEZ koloru osoby — to nie jest osoba. */
              background: p.id === null ? 'var(--fg-dim)' : personColor(p.name),
            }}
            onMouseMove={(e) => {
              const box = barRef.current?.getBoundingClientRect();
              if (!box) return;
              /* Pozycja WZGLEDEM paska — podpis ma isc za kursorem, nie stac
                 na srodku kawalka, ktory bywa szerszy niz pol panelu. */
              setHover({ name: p.name, points: p.points, at: e.clientX - box.left });
            }}
          />
        ))}

        {hover && (
          /*
           * Przy prawej krawedzi podpis ucieka w lewo, zeby nie wyszedl poza
           * panel — dokladnie jak odczyt na wykresie.
           */
          <span
            className="plan-load-tip"
            style={
              hover.at > (barRef.current?.clientWidth ?? 0) - 120
                ? { right: (barRef.current?.clientWidth ?? 0) - hover.at }
                : { left: hover.at }
            }
          >
            {hover.name}
            <b>{hover.points} SP</b>
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Pasek odniesienia: suma SP panelu wzgledem mocy zespolu.
 *
 * Wypelnienie to suma SP wzgledem `compare.points`, a kreska po prawej stoi na
 * 100% — czyli tam, gdzie sprint dorownuje mocom zespolu (albo temu, co dowiozl
 * ostatnio, gdy mocy nie wpisano). Kolor zmienia sie dopiero na granicy i po jej
 * przekroczeniu, zeby zwykly, niepelny sprint nie swiecil ostrzegawczo.
 *
 * `carry` to ta czesc sumy, ktora NIE jest zaplanowana, tylko przyjdzie sama —
 * niedomknieta praca z trwajacego sprintu. Rysujemy ja jako osobny, kreskowany
 * kawalek tego samego paska, bo to nie druga miara, tylko druga skladowa jednej:
 * te punkty zajma moce zespolu dokladnie tak samo jak wybrane recznie.
 */
function CompareBar({
  points,
  carry = 0,
  compare,
  dopisek,
}: {
  points: number;
  carry?: number;
  compare: { label: string; points: number };
  /** Druga linijka — skad wziely sie punkty przeniesione. */
  dopisek?: string;
}) {
  const pct = (v: number) => Math.min(100, (v / compare.points) * 100);
  /* Zaplanowane recznie, czyli suma bez przeniesienia. */
  const wybrane = Math.max(0, points - carry);
  const stan =
    points > compare.points
      ? ' plan-compare-ponad'
      : points === compare.points
        ? ' plan-compare-rowno'
        : '';

  return (
    <div className="plan-compare-row">
      <div className="plan-compare-bar">
        <i className={`plan-compare-fill${stan}`} style={{ width: `${pct(wybrane)}%` }} />
        {carry > 0 && (
          <i
            className={`plan-compare-fill plan-compare-carry${stan}`}
            style={{ left: `${pct(wybrane)}%`, width: `${Math.max(0, pct(points) - pct(wybrane))}%` }}
          />
        )}
        <span className="plan-compare-mark" />
      </div>
      <span className="plan-compare-note">
        {/*
          Etykieta w NAWIASIE, a nie wpleciona w zdanie: „ostatnio dowiezione
          (Sprint 67)" nie odmienia sie po polsku razem z reszta, wiec kazde
          wplecenie wychodzilo koslawo („do ostatnio dowiezione").
        */}
        {points > compare.points
          ? `+${points - compare.points} SP ponad ${compare.points} SP — ${compare.label}`
          : points === compare.points
            ? `Wypełnione co do punktu: ${compare.points} SP — ${compare.label}`
            : `Zostało ${compare.points - points} SP z ${compare.points} SP — ${compare.label}`}
        {dopisek && <span className="plan-compare-skad">{dopisek}</span>}
      </span>
    </div>
  );
}

/** Panel: naglowek z liczbami, pasek osob i lista wierszy. Jest celem upuszczania. */
function Pane({
  title,
  subtitle,
  sprintId,
  tasks,
  people,
  renderRow,
  ponad,
  collapsible = false,
  compare,
  carry,
  wMoce,
  grow,
}: {
  title: string;
  subtitle?: string;
  /** `null` = rejestr (backlog). */
  sprintId: number | null;
  tasks: Task[];
  people: { id: number; name: string; photo: string | null }[];
  /** Wiersz rysuje App — TYM SAMYM komponentem co lista, zeby widoki nie rozjechaly sie wygladem. */
  /**
   * Wiersz rysuje App (ten sam komponent co lista). Drugi argument to limit
   * tagow policzony z szerokosci TEGO panelu: panel zna swoja szerokosc, a App
   * wie, jak narysowac wiersz. Bez tego panel dostawal limit wyliczony dla
   * calej listy i tagi nie miescily sie w o polowe wezszym wierszu.
   */
  renderRow: (t: Task, limitTagow?: number) => React.ReactNode;
  /**
   * Czy zadanie NIE MIESCI sie w pozostalych punktach. Podaje to tylko rejestr —
   * w sprintach pytanie nie ma sensu, bo one sa juz policzone.
   */
  ponad?: (t: Task) => boolean;
  collapsible?: boolean;
  /** Odniesienie: ile SP zespol NAPRAWDE dowiozl ostatnio. */
  compare?: { label: string; points: number; wlasne?: boolean };
  /**
   * PRZENIESIENIE — niedomknieta praca z trwajacego sprintu, ktora wejdzie do
   * tego panelu sama, bez niczyjej decyzji.
   *
   * Licznik mocy liczony z samych zadan JUZ przypisanych do planowanego sprintu
   * klamal na korzysc: pokazywal wolne moce, ktore w rzeczywistosci sa zajete
   * przez to, czego nie skonczono. Panel dostaje wiec oba warianty — wybrane
   * recznie i to samo z doliczonym przeniesieniem — bo pierwszy odpowiada na
   * „ile wzielismy", a drugi na „ile zespol naprawde uniesie".
   *
   * Zadania, nie liczby: ten sam zestaw karmi licznik mocy i rozklad po osobach.
   */
  carry?: { tasks: Task[]; label: string };
  /**
   * Ktore zadania panelu ZAJMUJA MOCE zespolu. Brak = wszystkie.
   *
   * Liczby w naglowku opisuja to, co panel POKAZUJE (wraz z odsiewem
   * przelacznikow), a licznik mocy odpowiada na inne pytanie: ile pracy ten
   * sprint jeszcze zabierze. Praca zakonczona i oddana do akceptacji nie zabiera
   * juz nic, wiec do mocy nie wchodzi — inaczej wlaczenie „pokaz zakonczone"
   * podnosilo obciazenie sprintu, choc nic sie w nim nie zmienilo.
   */
  wMoce?: (t: Task) => boolean;
  /** Udzial w wysokosci kolumny (0-1). Brak = panel dzieli sie po rowno. */
  /** Ulamek miejsca. Tekst (`var(--plan-cols)`) pozwala ciagnac uchwyt bez renderu. */
  grow?: number | string;
}) {
  const [open, setOpen] = useState(true);
  const stats = useMemo(() => statsOf(tasks, people), [tasks, people]);
  /*
   * Wariant „z przeniesieniem" liczymy z SUMY obu zestawow, a nie z samego
   * przeniesienia: pytanie brzmi „ile bedzie w tym sprincie", wiec zadania
   * wybrane recznie musza sie w nim znalezc. `null`, gdy nie ma czego przenosic —
   * wtedy oba warianty bylyby tym samym paskiem dwa razy.
   */
  /* Zadania liczone do mocy — to z nich ida oba paski, a nie z tego, co widac. */
  const doMocy = useMemo(() => (wMoce ? tasks.filter(wMoce) : tasks), [tasks, wMoce]);
  const statsMoc = useMemo(
    () => (wMoce ? statsOf(doMocy, people) : stats),
    [wMoce, doMocy, people, stats],
  );
  const carryStats = useMemo(
    () => (carry && carry.tasks.length > 0 ? statsOf([...doMocy, ...carry.tasks], people) : null),
    [carry, doMocy, people],
  );
  const { setNodeRef, isOver, active } = useDroppable({ id: planDropId(sprintId) });

  /* Szerokosc TEGO panelu — zmienia sie przy ciagnieciu uchwytu i przy otwarciu
     panelu szczegolow, wiec mierzymy na zywo, a nie raz przy montowaniu. */
  const [szerokosc, setSzerokosc] = useState(0);
  const paneRef = useRef<HTMLElement | null>(null);
  /*
   * `useLayoutEffect`, nie `useEffect`, i odczyt OD RAZU — nie tylko przez
   * obserwatora. Sam `ResizeObserver` zostawal z zerem: lapal panel, zanim
   * uklad flex policzyl mu szerokosc, a pozniejsze ulozenie nie zawsze wywoluje
   * kolejne zgloszenie. Zero znaczylo „najwezszy mozliwy wiersz", wiec tagi
   * zwijaly sie do „+N" nawet na szerokim ekranie.
   */
  useLayoutEffect(() => {
    const el = paneRef.current;
    if (!el) return;
    setSzerokosc(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([w]) => setSzerokosc(w.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* Podswietlamy dopiero, gdy cos naprawde jest w reku — samo `isOver` lapie
     kazdy ruch myszy nad panelem. */
  const armed = Boolean(active);

  return (
    <section
      ref={(el) => {
        paneRef.current = el;
        setNodeRef(el);
      }}
      /*
       * `plan-pane-ciasny` wlacza sie ponizej 480 px — tam, gdzie limit tagow
       * spada juz do zera, a wiersz nadal sie nie miesci. Kolejnosc ustepowania:
       * najpierw tagi (dopisek), potem data zmiany (da sie ja odczytac z panelu
       * szczegolow), a awatar i tytul zostaja do konca, bo odpowiadaja na
       * „czyje to" i „co to".
       */
      className={`plan-pane${open ? '' : ' plan-pane-shut'}${armed ? ' plan-pane-armed' : ''}${isOver && armed ? ' plan-pane-over' : ''}${szerokosc > 0 && szerokosc < 480 ? ' plan-pane-ciasny' : ''}`}
      /* Zwiniety panel ignoruje podzial — ma byc samym naglowkiem. */
      style={grow !== undefined && open ? { flexGrow: grow, flexBasis: 0 } : undefined}
    >
      <header className="plan-head">
        {collapsible && (
          <button className="plan-fold" onClick={() => setOpen((v) => !v)} title="Zwiń / rozwiń">
            <ChevronIcon open={open} />
          </button>
        )}
        <h2>{title}</h2>
        {subtitle && <span className="plan-sub">{subtitle}</span>}

        {/*
          Kazda liczba ze SWOJA jednostka, jako osobny kawalek.
          Wczesniej bylo "69 SP · 21 zad." w jednym ciagu, z przygaszona
          jednostka — i czytalo sie jako "69 zadan". Zmiana kolejnosci tego nie
          naprawiala: winna byla jednostka doklejona ciszej niz liczba, przez co
          znikala. Teraz jednostka ma ten sam glos co liczba i nie da sie jej
          przeoczyc, a pary sa rozsuniete zamiast rozdzielone kropka.
        */}
        <span className="plan-nums">
          {/*
            „Bez SP" to ZASTRZEZENIE DO LICZBY ZADAN, a nie trzecia rownorzedna
            liczba: mowi, ilu z tych 59 nie policzono do sumy punktow. Stojac
            osobno, na koncu, czytalo sie jak kolejna miara panelu — i ciag
            „59 zadań 297 SP 6 bez SP" rozpadal sie na trzy niepowiazane liczby.
            W nawiasie, tuz przy swojej liczbie, wiadomo czego dotyczy.
          */}
          <span className="plan-num">
            <b>{stats.count}</b> {plural(stats.count)}
            {stats.unestimated > 0 && (
              <span className="plan-miss" title="Zadania bez oszacowania — nie wchodzą do sumy SP">
                {' '}
                ({stats.unestimated} bez SP)
              </span>
            )}
          </span>
          <span className="plan-num">
            <b>{stats.points}</b> SP
          </span>
          {compare && compare.points > 0 && statsMoc.points > compare.points && (
            <span className="plan-num plan-over" title={`${compare.label}: ${compare.points} SP`}>
              +{statsMoc.points - compare.points} SP ponad {compare.wlasne ? 'moce' : 'ostatni sprint'}
            </span>
          )}
        </span>
      </header>

      {/*
        LICZNIKI panelu: pasek mocy i rozklad po osobach. Gdy jest przeniesienie,
        oba sa POWTORZONE w dwoch wariantach — i wtedy nazwa wariantu stoi RAZ,
        nad swoja para. Wczesniej podpisywalismy kazdy pasek osobno, wiec
        „Z przeniesieniem" pojawialo sie dwa razy pod rzad i czytalo sie jak dwie
        rozne rzeczy, a nie dwa widoki jednej.
      */}
      {open && (
        <div className="plan-liczniki">
          <div className="plan-wariant">
            {carryStats && <span className="plan-wariant-podpis">Zaplanowane</span>}
            {compare && compare.points > 0 && (
              <CompareBar points={statsMoc.points} compare={compare} />
            )}
            <Load stats={statsMoc} zawsze={Boolean(carryStats)} />
          </div>

          {carryStats && (
            <div className="plan-wariant">
              <span className="plan-wariant-podpis">Z przeniesieniem</span>
              {compare && compare.points > 0 && (
                <CompareBar
                  points={carryStats.points}
                  carry={carryStats.points - statsMoc.points}
                  compare={compare}
                  dopisek={`${carry!.tasks.length} ${plural(carry!.tasks.length)} bez zakończenia w ${carry!.label} — ${carryStats.points - statsMoc.points} SP`}
                />
              )}
              <Load stats={carryStats} />
            </div>
          )}
        </div>
      )}

      {open && (
        <div className="plan-list">
          {tasks.length === 0 ? (
            <div className="plan-empty">
              {sprintId === null ? 'Rejestr jest pusty.' : 'Przeciągnij tutaj zadania z rejestru.'}
            </div>
          ) : (
            tasks.map((t, i) => {
              const za = ponad?.(t) ?? false;
              /* Kreska stoi RAZ, przy pierwszym zadaniu ponad limit — to granica
                 miedzy „da sie wziac" a „juz sie nie zmiesci", a nie ozdoba
                 kazdego wiersza. Lista jest posortowana tak, ze przekraczajace
                 leza na koncu, wiec granica jest dokladnie jedna. */
              const granica = za && !(i > 0 && (ponad?.(tasks[i - 1]) ?? false));
              return (
                <Fragment key={t.id}>
                  {granica && (
                    <div className="plan-granica" role="separator">
                      <span>nie mieści się w pozostałych punktach</span>
                    </div>
                  )}
                  <div className={za ? 'plan-row-ponad' : undefined}>
                    {renderRow(t, tagsForWidth(szerokosc))}
                  </div>
                </Fragment>
              );
            })
          )}
        </div>
      )}
    </section>
  );
}

export function Planning({
  tasks,
  activeSprint,
  nextSprint,
  onCreateSprint,
  lastDone,
  people,
  renderRow,
  showReview,
  onToggleReview,
  showDone,
  onToggleDone,
  moce,
  onMoce,
  dzialy,
  teraz,
  onLosuj,
  onPomin,
  onPrzestaw,
  onObecny,
  tylkoDoStartu,
  onTylkoDoStartu,
  sort,
  sortFields,
  onSort,
}: {
  /** Zadania JUZ przefiltrowane widokiem — stad liczby ida za filtrem. */
  tasks: Task[];
  activeSprint: Sprint | null;
  nextSprint: Sprint | null;
  /**
   * Zalozenie kolejnego sprintu. `undefined`, gdy nie ma z czego go zaproponowac
   * (brak aktywnego sprintu albo jego nazwa nie konczy sie numerem) — wtedy
   * przycisku nie ma, zamiast pokazywac taki, ktory nie wie, co zalozyc.
   */
  onCreateSprint?: () => void;
  /** Ostatni domkniety sprint i to, co w nim zostalo — czyli co dowieziono. */
  lastDone: { name: string; points: number } | null;
  /**
   * Moce zespolu na sprint w SP, wpisane recznie. `null` = nie ustawiono i za
   * odniesienie sluzy `lastDone`, czyli ile zespol naprawde dowiozl ostatnio.
   */
  moce: number | null;
  onMoce: (v: number | null) => void;
  /**
   * KOLEJKA DZIALOW — kto po kim wybiera zadanie do kolejnego sprintu. Dzialy to
   * epiki grupy, wiec nie ma tu drugiego slownika do utrzymywania.
   */
  dzialy: { id: number; nazwa: string; color: string | null; obecny: boolean }[];
  /** Dzial, ktorego jest tura. `null`, gdy nikt nie jest obecny. */
  teraz: { id: number; nazwa: string } | null;
  onLosuj: () => void;
  onPomin: () => void;
  onPrzestaw: (z: number, na: number) => void;
  onObecny: (id: number) => void;
  /** Czy rejestr w trakcie tury pokazuje tylko zadania z tagiem `DO-STARTU`. */
  tylkoDoStartu: boolean;
  onTylkoDoStartu: () => void;
  people: { id: number; name: string; photo: string | null }[];
  /** Wiersz rysuje App — tym samym komponentem co lista. */
  /** Jak wyzej w `Pane`: drugi argument to limit tagow policzony przez panel. */
  renderRow: (t: Task, limitTagow?: number) => React.ReactNode;
  /*
   * Filtry TEGO widoku — wlasne, nie te z panelu. Planowanie pyta "co bierzemy
   * dalej", wiec domyslnie bez zakonczonych, za to z oddanymi do akceptacji.
   */
  showReview: boolean;
  onToggleReview: () => void;
  showDone: boolean;
  onToggleDone: () => void;
  /*
   * STOS kluczy sortowania: pierwszy rozstrzyga, kolejny wchodzi przy remisie.
   * Klik zastepuje caly stos, Ctrl/Shift+klik dokłada poziom — ta sama umowa,
   * co przy zaznaczaniu zadan i przy wyborze osob na wykresie.
   */
  sort: { by: string; dir: 'asc' | 'desc' }[];
  sortFields: { key: string; label: string }[];
  onSort: (next: { by: string; dir: 'asc' | 'desc' }[]) => void;
}) {
  /*
   * REJESTR zawsze bez pracy domknietej i bez oddanej do akceptacji — jednego
   * ani drugiego nie da sie zaplanowac, wiec w rejestrze sa czystym szumem
   * (samych domknietych jest tam 144 na 336).
   *
   * Przelaczniki nad panelami dotycza WYLACZNIE sprintow: tam te zadania nadal
   * cos znacza — pokazuja, ile ze sprintu jest juz zrobione albo czeka na czyjas
   * akceptacje.
   */
  const plannable = useCallback(
    (t: Task) => !CLOSED_STATUSES.has(t.status) && !REVIEW_STATUSES.has(t.status),
    [],
  );
  const inSprintView = useCallback(
    (t: Task) =>
      (showDone || !CLOSED_STATUSES.has(t.status)) &&
      (showReview || !REVIEW_STATUSES.has(t.status)),
    [showDone, showReview],
  );

  /*
   * REJESTR w trakcie tury: tylko to, z czego dzial moze WZIASC zadanie —
   * jego epik i tag `DO-STARTU`. Bez tagu w rejestrze leza rzeczy jeszcze
   * niedomyslane (DO-WYWIADU, OCZEKUJE-NA-ODPOWIEDZ), ktorych nie ma sensu
   * wrzucac do sprintu.
   *
   * Gdy nikt nie ma tury (wszystkie dzialy pominiete), nie zawezamy niczego —
   * pusty rejestr wygladalby na awarie, a nie na stan kolejki.
   */
  const backlog = useMemo(() => {
    const wszystkie = tasks.filter((t) => t.sprintId === null && plannable(t));
    if (!teraz) return wszystkie;
    return wszystkie.filter(
      (t) =>
        t.epicId === teraz.id &&
        (!tylkoDoStartu || t.tags.some((g) => g.toUpperCase() === 'DO-STARTU')),
    );
  }, [tasks, plannable, teraz, tylkoDoStartu]);

  const inActive = useMemo(
    () =>
      activeSprint ? tasks.filter((t) => t.sprintId === activeSprint.id && inSprintView(t)) : [],
    [tasks, activeSprint, inSprintView],
  );
  const inNext = useMemo(
    () => (nextSprint ? tasks.filter((t) => t.sprintId === nextSprint.id && inSprintView(t)) : []),
    [tasks, nextSprint, inSprintView],
  );

  /*
   * PRZENIESIENIE: co z trwajacego sprintu NIE jest zakonczone.
   *
   * Przy zamknieciu sprintu zostaje w nim tylko praca domknieta — reszta idzie do
   * kolejnego (patrz `sprint-lifecycle`). Te punkty zajma wiec moce planowanego
   * sprintu, choc nikt ich do niego nie wybieral.
   *
   * Liczymy z `tasks`, a NIE z `inActive`: `inActive` przechodzi przez
   * przelaczniki widoku, a przeniesienie jest faktem o sprincie, nie o tym, co
   * ktos sobie wlasnie odsiał.
   *
   * „Czeka na kontrolę" liczy sie jak ZROBIONE (decyzja Wojciecha 2026-09-28):
   * praca jest oddana, zostala cudza akceptacja, wiec nie zajmie mocy zespolu w
   * nastepnym sprincie — nawet jesli formalnie przywedruje razem z zadaniem.
   * Doliczanie jej zawyzalo przeniesienie i kazalo planowac ponizej mozliwosci.
   */
  const carry = useMemo(() => {
    if (!activeSprint) return undefined;
    const zostajace = tasks.filter(
      (t) =>
        t.sprintId === activeSprint.id &&
        !CLOSED_STATUSES.has(t.status) &&
        !REVIEW_STATUSES.has(t.status),
    );
    return zostajace.length > 0 ? { tasks: zostajace, label: activeSprint.name } : undefined;
  }, [tasks, activeSprint]);

  /*
   * Odniesienie dla sum SP. Recznie wpisane moce maja pierwszenstwo nad tym, co
   * zespol dowiozl ostatnio — bo urlopy, swieta i zmiana skladu zmieniaja
   * pojemnosc tygodnia, a historia sama tego nie wie.
   */
  const limit = moce ?? lastDone?.points ?? 0;

  /*
   * KOLEJNOSC WAZNOSCI w rejestrze — to po niej dzial czyta, co brac najpierw:
   *   1. zadania, ktore NIE MIESZCZA sie w pozostalych punktach, ida na DOL
   *      (osobno, na czerwono — nie da sie ich wziac bez przekroczenia mocy),
   *   2. priorytet wysoki z Bitriksa (plomien),
   *   3. tag „Wysoki",
   *   4. story pointy malejaco.
   *
   * Zostalo liczymy wzgledem KOLEJNEGO sprintu, bo to do niego sie wybiera.
   */
  /*
   * Liczymy z `tasks`, nie z `inNext`: `inNext` jest odsiane przelacznikami
   * widoku, a moce sprintu nie zaleza od tego, co ktos wlasnie ma na ekranie.
   * Zakonczone i oddane do akceptacji nie zajmuja juz mocy (`plannable`).
   */
  const sumaNext = nextSprint
    ? tasks
        .filter((t) => t.sprintId === nextSprint.id && plannable(t))
        .reduce((n, t) => n + (t.storyPoints ?? 0), 0)
    : 0;
  const zostalo = Math.max(0, limit - sumaNext);

  const backlogUlozony = useMemo(() => {
    /*
     * Kolejnosc ustawia PRZELACZNIK sortowania (zadania przychodza juz ulozone).
     * Tutaj zostaje jedna rzecz, ktora nie jest sortowaniem, tylko granica: co
     * nie miesci sie w pozostalych punktach, spada na sam dol. `sort` w JS jest
     * stabilny, wiec w obu czesciach wybrana kolejnosc zostaje nietknieta.
     */
    if (zostalo <= 0) return backlog;
    const ponad = (t: Task) => ((t.storyPoints ?? 0) > zostalo ? 1 : 0);
    return [...backlog].sort((a, b) => ponad(a) - ponad(b));
  }, [backlog, zostalo]);

  const compare =
    limit > 0
      ? {
          label: moce !== null ? 'Moce zespołu' : `Ostatnio dowiezione (${lastDone?.name ?? ''})`,
          points: limit,
          wlasne: moce !== null,
        }
      : undefined;

  /*
   * Podzial wysokosci prawej kolumny miedzy sprint aktywny a kolejny.
   * Trzymamy UŁAMEK, nie piksele: okno bywa zmieniane, a proporcja przezywa to
   * bez przeliczen. Suwak tylko przesuwa granice — zwijanie chevronem dziala
   * dalej i ma pierwszenstwo.
   */
  const [sortAt, setSortAt] = useState<Anchor | null>(null);
  /* Kolejka dzialow schowana pod przyciskiem: jej UKLADANIE to czynnosc
     jednorazowa (raz na spotkanie), a stale zajmowala caly rzad. W pasku zostaje
     to, co zmienia sie w trakcie — czyja jest tura. */
  const [kolejkaAt, setKolejkaAt] = useState<{ left: number; top: number } | null>(null);
  const [pokazAt, setPokazAt] = useState<{ left: number; top: number } | null>(null);
  const [split, setSplit] = useState(SPLIT_DEFAULT);
  /** Podzial POZIOMY: rejestr kontra kolumna ze sprintami. */
  const [cols, setCols] = useState(0.5);
  const rightRef = useRef<HTMLDivElement>(null);
  const colsRef = useRef<HTMLDivElement>(null);
  /* Korzen widoku — tu siedza OBIE zmienne podzialu, zeby odziedziczyl je takze
     pasek nad kolumnami, ktory jest rodzenstwem `.plan-cols`, a nie dzieckiem. */
  const planRef = useRef<HTMLDivElement>(null);

  /**
   * Wspolna obsluga obu uchwytow — pionowego i poziomego.
   *
   * Rozni je tylko os, wiec dwie kopie tej samej petli zdarzen roznilyby sie
   * jednym slowem i rozjechaly przy pierwszej poprawce.
   *
   * Nasluch wisi na OKNIE, nie na uchwycie: kursor przy szybkim ruchu wyprzedza
   * 4-pikselowy pasek i zdarzenia przestalyby dochodzic w polowie przeciagania.
   */
  const drag = useCallback(
    (
      axis: 'x' | 'y',
      box: React.RefObject<HTMLDivElement | null>,
      set: (f: number) => void,
    ) =>
      (e: React.PointerEvent) => {
        e.preventDefault();
        const el = box.current;
        if (!el) return;

        /*
         * W TRAKCIE ciagniecia NIE ruszamy stanu Reacta — tylko zmienna CSS na
         * kontenerze, z ktorej panele biora `flex-grow`.
         *
         * Wczesniej kazdy `pointermove` wolal `set()`, czyli przerysowywal caly
         * widok planowania: oba panele sprintow, rejestr i kazdy wiersz w nich.
         * Przy kilkuset zadaniach uchwyt szarpal, bo na jedno drgniecie myszy
         * przypadal pelny render. Teraz rusza sie jedna wlasciwosc na jednym
         * elemencie, a stan dostaje wartosc RAZ, przy puszczeniu — zeby podzial
         * przezyl odswiezenie.
         */
        const zmienna = axis === 'y' ? '--plan-split' : '--plan-cols';
        /* MIERZYMY pudelko kolumn, ale PISZEMY na korzeniu — zmienna musi dojsc
           takze do paska, ktory lezy poza tym pudelkiem. */
        const cel = planRef.current ?? el;
        let ostatni: number | null = null;

        const move = (ev: PointerEvent) => {
          const r = el.getBoundingClientRect();
          const f =
            axis === 'y' ? (ev.clientY - r.top) / r.height : (ev.clientX - r.left) / r.width;
          /* Po 12% z kazdej strony zostaje nietykalne: panel scisniety do zera
             nie ma juz za co zostac zlapany z powrotem. */
          ostatni = Math.min(0.88, Math.max(0.12, f));
          cel.style.setProperty(zmienna, String(ostatni));
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          /* Dopiero teraz jeden render — i zdjecie nadpisania, zeby dalej rzadzil stan. */
          if (ostatni !== null) {
            cel.style.removeProperty(zmienna);
            set(ostatni);
          }
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      },
    [],
  );

  return (
    <div
      className="plan"
      ref={planRef}
      style={
        {
          ['--plan-cols' as string]: String(cols),
          ['--plan-split' as string]: String(split),
        } as React.CSSProperties
      }
    >
      {/*
        Pasek nalezy WYLACZNIE do planowania — oba przelaczniki rusza tylko
        panele sprintow, a nie liste i tablice. Odsiew „do zatwierdzenia" znikl
        z panelu widoku: praca oddana do akceptacji jest tam normalna trescia,
        a przeszkadza dopiero przy planowaniu, gdzie nie da sie jej juz ani
        przypisac, ani przelozyc, a zawyza sumy SP.

        Podzial paska jest DOKLADNIE taki, jak kolumn pod nim: sortowanie nad
        rejestrem, filtry nad sprintami — bo tylko ich dotycza.
      */}
      <div className="plan-bar">
        <div className="plan-bar-side" style={{ flexGrow: 'var(--plan-cols)', flexBasis: 0 }}>
          {/* Sortowanie tuz przy widoku, zamiast w panelu — przy planowaniu
              zmienia sie je czesto: raz po priorytecie, raz po terminie. */}
          <button
            className="views-btn plan-sort"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setSortAt(sortAt ? null : { left: r.left - 32, top: r.bottom + 4, bottom: r.bottom + 4 });
            }}
            title="Kolejność zadań w panelach — klik zastępuje, Ctrl/Shift+klik dokłada poziom"
          >
            <BarsIcon />
            <span className="display-label">Sortuj:</span>
            <span className="plan-sort-val">
              {sort.map((lvl, i) => (
                <span key={lvl.by} className="plan-sort-lvl">
                  {i > 0 && <span className="plan-sort-then">, potem</span>}
                  {sortFields.find((f) => f.key === lvl.by)?.label ?? lvl.by}
                  <span className="plan-sort-dir">{lvl.dir === 'asc' ? '↑' : '↓'}</span>
                </span>
              ))}
            </span>
            <ChevronIcon open={Boolean(sortAt)} />
          </button>

          {sortAt && (
            <Picker
              title="Sortuj"
              anchor={sortAt}
              selected={sort.map((l) => l.by)}
              options={sortFields.map((f) => {
                const at = sort.findIndex((l) => l.by === f.key);
                return {
                  value: f.key,
                  label: f.label,
                  /* Numer poziomu przy nazwie — bez niego nie widac, ktory klucz
                     rozstrzyga pierwszy, a to cala tresc tego stosu. */
                  hint: at >= 0 ? `${at + 1}. ${sort[at].dir === 'asc' ? '↑' : '↓'}` : undefined,
                };
              })}
              onPick={(v, add) => {
                const at = sort.findIndex((l) => l.by === v);
                const flip = (d: 'asc' | 'desc') => (d === 'asc' ? 'desc' : 'asc');

                /*
                 * Lista NIE zamyka sie po wyborze — ani przy zwyklym kliknieciu,
                 * ani przy Ctrl. Kolejnosc ustawia sie porownawczo: klika sie klucz,
                 * patrzy na panele, poprawia kierunek, dokłada drugi poziom. Zamykanie
                 * po kazdym kliknieciu kazaloby otwierac ja od nowa przy kazdej z tych
                 * prob. Zamyka ja Esc, klik obok albo ponowny klik w chip.
                 */
                if (!add) {
                  /* Ten sam klucz drugi raz odwraca kierunek — jak naglowek tabeli. */
                  onSort([{ by: v, dir: at === 0 ? flip(sort[0].dir) : 'desc' }]);
                  return;
                }

                if (at >= 0) {
                  onSort(
                    at === sort.length - 1 && sort.length > 1
                      ? sort.filter((l) => l.by !== v)
                      : sort.map((l) => (l.by === v ? { ...l, dir: flip(l.dir) } : l)),
                  );
                  return;
                }
                onSort([...sort, { by: v, dir: 'desc' }]);
              }}
              footer={
                <>
                  <button
                    className="btn plan-sort-reset"
                    /* Trzy poziomy, nie jeden — dokladnie te, ktore skladaja sie
                       na kolejnosc waznosci, zeby bylo je widac i dalo poprawic. */
                    onClick={() =>
                      onSort([
                        { by: 'priority', dir: 'asc' },
                        { by: 'wysoki', dir: 'asc' },
                        { by: 'sp', dir: 'desc' },
                      ])
                    }
                    title="Priorytet Bitriksa, potem tag „Wysoki”, potem story pointy malejąco"
                  >
                    Domyślna kolejność ważności
                  </button>
                  <span className="plan-sort-hint">
                    <kbd>Ctrl</kbd> lub <kbd>Shift</kbd> + klik — dołóż kolejny poziom
                  </span>
                </>
              }
              onClose={() => setSortAt(null)}
            />
          )}
        </div>

        <div
          className="plan-bar-side plan-bar-right"
          style={{ flexGrow: 'calc(1 - var(--plan-cols))', flexBasis: 0 }}
        >
          {/*
            Moce zespolu na sprint. Puste pole NIE znaczy zero — znaczy „nie
            wiem", i wtedy za odniesienie sluzy to, co zespol dowiozl ostatnio.
            Dlatego podpowiedz w polu pokazuje te liczbe: widac, co sie stanie po
            wyczyszczeniu, bez zgadywania.
          */}
          {/* Czyja tura + wejscie do kolejki. Nazwa dzialu stoi RAZ — wczesniej
              byla i tekstem, i podswietlona pastylka w tym samym rzedzie. */}
          <span className="display-label plan-show">Teraz:</span>
          <span className="plan-teraz">{teraz ? teraz.nazwa : 'nikt'}</span>
          <button
            className="views-btn plan-kolejka-btn"
            onClick={(e) => {
              if (kolejkaAt) {
                setKolejkaAt(null);
                return;
              }
              /* Mierzymy PRZYCISK, nie pasek — panel ma wisiec pod nim, dosuniety
                 prawa krawedzia, i nie wyjsc poza okno na waskim ekranie. */
              const r = e.currentTarget.getBoundingClientRect();
              const szer = 240;
              setKolejkaAt({
                left: Math.max(8, Math.min(r.right - szer, window.innerWidth - szer - 8)),
                top: r.bottom + 4,
              });
            }}
            title="Kolejność działów, obecność, losowanie"
          >
            Kolejka
            <ChevronIcon open={Boolean(kolejkaAt)} />
          </button>
          <button className="views-btn" onClick={onPomin} title="Ten dział nie wybiera — następny">
            Pomiń
          </button>

          {kolejkaAt &&
            createPortal(
              <>
                <div className="picker-backdrop" onClick={() => setKolejkaAt(null)} />
                <div className="menu plan-kolejka" style={{ left: kolejkaAt.left, top: kolejkaAt.top }}>
                <div className="ds-colhead">Kolejka działów</div>
                <div className="ds-colhint">
                  Przeciągnij, żeby zmienić kolejność. Odznaczony dział nie dostaje tury.
                </div>
                <ol className="plan-kolejka-list">
                  {dzialy.map((d, i) => (
                    <li
                      key={d.id}
                      className={`plan-kolejka-item${d.id === teraz?.id ? ' is-now' : ''}${d.obecny ? '' : ' is-off'}`}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = 'move';
                        /* Firefox nie zaczyna przeciagania bez ustawionych danych. */
                        e.dataTransfer.setData('text/plain', String(i));
                      }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const z = Number(e.dataTransfer.getData('text/plain'));
                        if (Number.isFinite(z)) onPrzestaw(z, i);
                      }}
                    >
                      <button
                        type="button"
                        className="plan-kolejka-chk"
                        title={d.obecny ? 'Pomiń ten dział' : 'Włącz z powrotem'}
                        onClick={() => onObecny(d.id)}
                      >
                        {d.obecny ? <CheckIcon /> : null}
                      </button>
                      <span className="plan-kolejka-nr">{i + 1}</span>
                      <span className="plan-kolejka-nazwa">{d.nazwa}</span>
                    </li>
                  ))}
                </ol>
                  <button className="btn plan-kolejka-losuj" onClick={onLosuj}>
                    Losuj kolejność
                  </button>
                </div>
              </>,
              document.body,
            )}

          <span className="plan-bar-div" aria-hidden />

          {/*
            Moce i trzy przelaczniki schowane pod jednym przyciskiem — tak samo
            jak kolejka. Rozlozone w pasku nie miescily sie przy otwartym panelu
            szczegolow: pasek konczy sie tam, gdzie zaczyna panel, wiec nadmiar
            wychodzil POD niego i ostatnie przelaczniki bylo widac tylko w polowie.
          */}
          <button
            className="views-btn"
            onClick={(e) => {
              if (pokazAt) {
                setPokazAt(null);
                return;
              }
              const r = e.currentTarget.getBoundingClientRect();
              const szer = 250;
              setPokazAt({
                left: Math.max(8, Math.min(r.right - szer, window.innerWidth - szer - 8)),
                top: r.bottom + 4,
              });
            }}
            title="Moce zespołu i co ma być widoczne"
          >
            {/* „Opcje", nie „Pokaż" — pod spodem sa dwie rozne rzeczy: moce
                zespolu (liczba) i widocznosc (przelaczniki). „Pokaż" nazywalo
                tylko te druga polowe. */}
            Opcje
            <ChevronIcon open={Boolean(pokazAt)} />
          </button>

          {pokazAt &&
            createPortal(
              <>
                <div className="picker-backdrop" onClick={() => setPokazAt(null)} />
                <div className="menu plan-pokaz" style={{ left: pokazAt.left, top: pokazAt.top }}>
                  <div className="ds-colhead">Moce zespołu</div>
                  <label className="plan-pokaz-moce">
                    <input
                      className="plan-moce"
                      type="number"
                      min={0}
                      step={1}
                      inputMode="numeric"
                      value={moce ?? ''}
                      placeholder={lastDone ? String(lastDone.points) : '—'}
                      onChange={(e) => {
                        const v = e.target.value.trim();
                        onMoce(v === '' ? null : Math.max(0, Number(v) || 0));
                      }}
                    />
                    <span className="plan-moce-unit">SP na sprint</span>
                  </label>
                  <div className="ds-colhint">
                    {moce === null && lastDone
                      ? `Puste — liczymy do ostatnio dowiezionego (${lastDone.name}: ${lastDone.points} SP).`
                      : 'Ile SP zespół jest w stanie wziąć na sprint.'}
                  </div>

                  <div className="ds-colhead">Pokaż w rejestrze i sprintach</div>
                  <button
                    className={`menu-item tog${tylkoDoStartu ? ' tog-on' : ''}`}
                    onClick={onTylkoDoStartu}
                  >
                    <span className="tog-box">
                      <CheckIcon />
                    </span>
                    tylko DO-STARTU
                  </button>
                  <button
                    className={`menu-item tog${showReview ? ' tog-on' : ''}`}
                    onClick={onToggleReview}
                  >
                    <span className="tog-box">
                      <CheckIcon />
                    </span>
                    do zatwierdzenia
                  </button>
                  <button
                    className={`menu-item tog${showDone ? ' tog-on' : ''}`}
                    onClick={onToggleDone}
                  >
                    <span className="tog-box">
                      <CheckIcon />
                    </span>
                    zakończone
                  </button>
                </div>
              </>,
              document.body,
            )}
        </div>
      </div>

      <div className="plan-cols" ref={colsRef}>
      <Pane
        title="Rejestr"
        sprintId={null}
        tasks={backlogUlozony}
        ponad={(t) => zostalo > 0 && (t.storyPoints ?? 0) > zostalo}
        people={people}
        renderRow={renderRow}
        grow="var(--plan-cols)"
      />

      {/* Uchwyt pionowy: ile miejsca dostaje rejestr, a ile sprinty. */}
      <div
        className="plan-grip plan-grip-v"
        role="separator"
        aria-orientation="vertical"
        title="Przeciągnij, żeby zmienić szerokość kolumn"
        onPointerDown={drag('x', colsRef, setCols)}
        onDoubleClick={() => setCols(0.5)}
      >
        <span className="plan-grip-dots">
          <GripIcon />
        </span>
      </div>

      <div
        className="plan-right"
        ref={rightRef}
        style={{ flexGrow: 'calc(1 - var(--plan-cols))', flexBasis: 0 }}
      >
        {activeSprint && (
          <Pane
            title={activeSprint.name}
            subtitle="aktywny"
            grow="var(--plan-split)"
            sprintId={activeSprint.id}
            tasks={inActive}
            people={people}
            renderRow={renderRow}
            collapsible
            /* Bez licznika mocy: w trwajacym sprincie nie ma juz czego planowac. */
          />
        )}

        {activeSprint && nextSprint && (
          /* Uchwyt miedzy sprintami — chwyt myszy zmienia podzial wysokosci. */
          <div
            className="plan-grip"
            role="separator"
            aria-orientation="horizontal"
            title="Przeciągnij, żeby zmienić podział wysokości"
            onPointerDown={drag('y', rightRef, setSplit)}
            onDoubleClick={() => setSplit(SPLIT_DEFAULT)}
          >
            {/* Kropki na srodku — bez nich pasek czyta sie jak zwykla kreska
                rozdzielajaca i nikt nie zgaduje, ze da sie go chwycic. */}
            <span className="plan-grip-dots">
              <GripIcon />
            </span>
          </div>
        )}

        {nextSprint ? (
          <Pane
            title={nextSprint.name}
            subtitle="planowany"
            grow="calc(1 - var(--plan-split))"
            sprintId={nextSprint.id}
            tasks={inNext}
            people={people}
            renderRow={renderRow}
            collapsible
            compare={compare}
            carry={carry}
            wMoce={plannable}
          />
        ) : (
          /* Bez kolejnego sprintu planowac nie ma dokad — mowimy to wprost,
             zamiast pokazywac pusty panel bez wyjasnienia. */
          <section className="plan-pane plan-pane-none">
            <div className="plan-empty">
              Nie ma zaplanowanego kolejnego sprintu.
              {onCreateSprint ? (
                <>
                  {' '}
                  Bez niego nie ma dokąd planować.
                  <button className="btn btn-primary plan-new-sprint" onClick={onCreateSprint}>
                    Załóż kolejny sprint
                  </button>
                </>
              ) : (
                ' Załóż go w Bitriksie, a pojawi się tutaj.'
              )}
            </div>
          </section>
        )}
      </div>
      </div>
    </div>
  );
}
