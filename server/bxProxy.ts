import type { Connect, Plugin } from 'vite';
import { loadEnv } from 'vite';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const run = promisify(execFile);

/**
 * Metody REST dopuszczone przez proxy. Webhook daje pelny dostep do portalu,
 * wiec przegladarka moze wywolac wylacznie to, co jest tu wymienione.
 * MVP jest read-only - mutacje (tasks.task.update, task.stages.movetask,
 * task.commentitem.add) dokladamy dopiero razem z UI, ktore ich uzywa.
 */
const ALLOWED = new Set([
  'batch', // laczy do 50 wywolan w jedno zapytanie HTTP — bez tego lista to 20 round-tripow
  // odczyt
  'tasks.task.list',
  'tasks.task.get',
  'tasks.task.getFields',
  'tasks.api.scrum.kanban.getStages',
  'tasks.api.scrum.sprint.list',
  'tasks.api.scrum.sprint.add', // zalozenie kolejnego sprintu z widoku planowania
  'tasks.api.scrum.backlog.get', // id backlogu — bez niego nie ma jak wyjac zadania ze sprintu
  'tasks.api.scrum.epic.list', // epiki grupy — nadrzedne tematy scruma (badge + filtr)
  'tasks.api.scrum.task.get', // scrumowa czesc zadania: entityId, storyPoints, kod nadany przez Bitrix
  'tasks.task.history.list', // dziennik zmian zadania — z niego liczymy czas w statusie "W toku"
  'task.item.getdependson', // zadania powiazane (DEPENDS_ON) — nowe tasks.task.* tego pola nie zna
  'task.commentitem.getlist',
  'im.dialog.messages.get', // komentarze zadan zyja dzis w czacie, nie na forum
  'sonet_group.user.groups', // projekty uzytkownika — lista w przelaczniku
  'user.get',
  'disk.attachedObject.get', // zalaczniki zadania (w batch z src/bitrix.ts); sam plik idzie przez /api/attach
  // zapis — kazda zmiana idzie jako uzytkownik z URL-a webhooka
  'tasks.task.update',
  'task.item.update', // legacy CTaskItem::update — jedyna droga zapisu DEPENDS_ON (zadania powiazane)
  'task.stages.movetask',
  'tasks.api.scrum.task.update', // sprint <-> backlog; przynaleznosc trzyma scrum, nie pole zadania
  // zarzadzanie epikami projektu (okno „Tagi i epiki")
  'tasks.api.scrum.epic.add',
  'tasks.api.scrum.epic.update',
  'tasks.api.scrum.epic.delete',
  /*
   * KARTA na tablicy sprintu. Bez niej wejscie do sprintu jest tylko wpisem w
   * bazie: zadanie ma sprint i etap, ale na tablicy Bitriksa karty nie ma, wiec
   * reguly kolumny nie maja czego "wpuscic" i nie odpalaja (a to one nadaja
   * numer IT-XXX). Patrz `moveToSprint` w src/bitrix.ts.
   */
  'tasks.api.scrum.kanban.addTask',
  'task.commentitem.add',
  /*
   * Zmiana tresci komentarza. Dwie metody, bo komentarze leza w dwoch miejscach
   * i kazde ma swoje (patrz `editComment` w src/bitrix.ts): forum zmienia sie
   * metoda zadaniowa, czat — metoda od wiadomosci.
   *
   * Dla czatu WERSJA v2, a nie `im.message.update`: ta druga ma okno czasowe
   * i po nim odmawia (`CANT_EDIT_MESSAGE`). Szczegoly przy `editComment`.
   */
  'task.commentitem.update',
  'im.v2.Chat.Message.update',
  /* Usuniecie komentarza — nieodwracalne, w UI zawsze za potwierdzeniem. */
  'task.commentitem.delete',
  'im.v2.Chat.Message.delete',
  /*
   * Reakcje na komentarze. `im.dialog.messages.get` zna tylko „lajki" bez rodzaju, wiec rodzaj
   * czytamy z v2 (`list` — najnowsza strona, `tail` — starsze), a dajemy/zdejmujemy przez
   * `Reaction.add` / `Reaction.delete`. Patrz `setReaction` w src/bitrix.ts.
   */
  'im.v2.Chat.Message.list',
  'im.v2.Chat.Message.tail',
  'im.v2.Chat.Message.Reaction.add',
  'im.v2.Chat.Message.Reaction.delete',
  /*
   * Zalacznik komentarza (wklejony zrzut ekranu). Trzy kroki, bo Bitrix nie ma
   * na to jednego wywolania — patrz `addCommentWithFiles` w src/bitrix.ts.
   */
  'im.disk.folder.get',
  'disk.folder.uploadfile',
  'im.disk.file.commit',
  'task.checklistitem.complete', // odhaczenie pozycji checklisty
  'task.checklistitem.renew', // cofniecie odhaczenia
  'tasks.task.delete', // usuniecie zadania — nieodwracalne, w UI zawsze za potwierdzeniem
  /*
   * SONDY do panelu „Uprawnienia" (patrz src/perms.ts). Wolane BEZ PARAMETROW,
   * wiec niczego nie zapisuja — chodzi wylacznie o to, jakim bledem odpowie
   * portal. Reszta listy sond to metody juz wymienione wyzej.
   */
  'timeman.status',
  'timeman.settings',
  'timeman.schedule.get',
  'timeman.record.list',
  'timeman.timecontrol.reports.get',
  'timeman.timecontrol.reports.settings.get',
  'timeman.timecontrol.reports.users.get',
  'timeman.timecontrol.settings.get',
  'department.get',
]);

/** Serializacja zagniezdzonych parametrow w formacie, ktorego oczekuje Bitrix (PHP-style brackets). */
function encodeParams(value: unknown, prefix = '', out: string[] = []): string[] {
  if (value === null || value === undefined) return out;

  if (Array.isArray(value)) {
    value.forEach((item, i) => encodeParams(item, `${prefix}[${i}]`, out));
    return out;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      encodeParams(v, prefix ? `${prefix}[${k}]` : k, out);
    }
    return out;
  }
  out.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(String(value))}`);
  return out;
}

/** Cialo zapytania jako tekst; z `max` (bajty) odrzuca wieksze, zamiast trzymac je w pamieci. */
function readBody(req: Connect.IncomingMessage, max = Infinity): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    // Za duze: dalej czytamy (i wyrzucamy), zeby odpowiedz 413 doszla — zerwane polaczenie dawalo tylko blad sieci.
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size <= max) chunks.push(c);
      else chunks.length = 0;
    });
    req.on('end', () => (size > max ? reject(new BodyTooLarge()) : resolve(Buffer.concat(chunks).toString('utf8'))));
    req.on('error', reject);
  });
}

class BodyTooLarge extends Error {}

/**
 * Czy zapytanie przyszlo z samej aplikacji. Przegladarka dokleja Origin do kazdego POST/PUT z innej strony,
 * wiec bez tego dowolna otwarta strona mogla wolac nasze lokalne endpointy. Brak Origin = nie przegladarka
 * z innej strony (curl, ten sam adres) — przepuszczamy.
 */
export function sameOrigin(req: Pick<Connect.IncomingMessage, 'headers'>): boolean {
  const origin = req.headers.origin;
  return !origin || origin.replace(/^https?:\/\//, '') === req.headers.host;
}

/**
 * Co jest nie tak z wywolaniem `batch` — albo `null`, gdy mozna je puscic.
 *
 * `batch` niesie w `cmd` wlasne wywolania ("metoda?parametry") — kazde musi przejsc te sama allowliste, inaczej
 * batch byl furtka do dowolnej metody webhooka (np. tasks.task.delete). Batch w batchu tez nie. Klucze tylko
 * `cmd` i `halt` dokladnie tak napisane: `cmd[x]`, ` cmd` albo `CMD` omijaly sprawdzenie, a Bitrix i tak czyta
 * je jako wywolania (PHP dekoduje nazwy i sklada nawiasy).
 */
export function batchViolation(params: unknown): string | null {
  const obj = params && typeof params === 'object' ? (params as Record<string, unknown>) : {};
  if (Object.keys(obj).some((k) => k !== 'cmd' && k !== 'halt')) return 'Niedozwolony klucz w batch';
  const cmd = obj.cmd;
  const calls = cmd && typeof cmd === 'object' ? Object.values(cmd as Record<string, unknown>) : [];
  const bad = calls.map((c) => String(c).split('?')[0]).find((m) => m.toLowerCase() === 'batch' || !ALLOWED.has(m));
  return bad === undefined ? null : `Metoda spoza allowlisty w batch: ${bad}`;
}

/**
 * Zawartosc pliku zespolow. `text === null` = pliku nie ma (pusto). `strict` (zapis): uszkodzony plik rzuca —
 * inaczej zapis jednego projektu nadpisalby go samym soba i skasowal zespoly wszystkich pozostalych.
 */
export function parseTeams(text: string | null, strict: boolean): Record<string, unknown> {
  if (text === null) return {};
  try {
    const p = JSON.parse(text);
    if (p && typeof p === 'object' && !Array.isArray(p)) return p;
  } catch {
    /* nizej */
  }
  if (strict) throw new Error('plik zespolow jest uszkodzony — popraw albo usun plik');
  return {};
}

/**
 * HTML do PDF z polityka CSP wstawiona zaraz po `<head>` — albo `null`, gdy `<head>` nie ma (`<header>` sie
 * nie liczy). Polityka blokuje skrypty i pliki lokalne (file://): headless Chrome renderuje tylko to, co przyslano.
 */
export function withCsp(html: string, host: string | undefined): string | null {
  const head = /<head(\s[^>]*)?>/i;
  if (!head.test(html)) return null;
  const self = `http://${host}`;
  const csp =
    `default-src 'none'; img-src ${self} data: https:; font-src ${self} data: https:; ` +
    `style-src 'unsafe-inline' ${self} https:`;
  return html.replace(head, (h) => `${h}<meta http-equiv="Content-Security-Policy" content="${csp}">`);
}

/**
 * Naglowek z NAZWA pliku. Bez niego przegladarka zapisuje plik pod ostatnim
 * czlonem adresu, czyli "31279" — bez rozszerzenia i bez nazwy. PDF jeszcze sie
 * otworzy (po `content-type`), ale zapisany .docx czy .xlsx jest bezuzyteczny.
 *
 * `inline`, nie `attachment`: obrazki i PDF-y maja sie dalej otwierac w karcie,
 * a nazwa jest potrzebna dopiero przy "Zapisz jako".
 *
 * `filename*` w formacie RFC 5987, bo nazwy bywaja polskie ("limity_wysyłki…")
 * i spacjowane — samo `filename="..."` gubi znaki spoza ASCII.
 */
function contentDisposition(name: string): string {
  return `inline; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * Przegladarka do generowania PDF (headless `--print-to-pdf`). Najpierw `BX_PDF_BROWSER` z .env, potem
 * typowe sciezki Edge / Chrome / Chromium. `null`, gdy zadnej nie ma — front pobiera wtedy plik HTML.
 */
function findPdfBrowser(custom: string | undefined): string | null {
  const candidates = [
    custom,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ];
  return candidates.find((p): p is string => Boolean(p) && existsSync(p as string)) ?? null;
}

export function bxProxy(mode: string): Plugin {
  const env = loadEnv(mode, process.cwd(), '');
  const webhook = (env.BITRIX_WEBHOOK || '').replace(/\/+$/, '');
  const groupId = env.BX_GROUP_ID || '451';
  // Konto-zaslepka "Nieprzypisane" — patrz .env.example. Domyslnie 251 (Klaudiusz Koder).
  const unassignedId = Number(env.BX_UNASSIGNED_ID) || 251;
  // Dzialy IT (np. "79,81") — licznik odpowiedzi w czacie. Patrz .env.example.
  const itDepartments = (env.BX_IT_DEPARTMENTS || '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  // Konta liczone jako IT niezaleznie od dzialu — np. konto, z ktorego automat zadaje pytania.
  const itUsers = (env.BX_IT_USERS || '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  // Odliczanie do konca sprintu: ilu programistow liczymy (1 godzina = 1 SP na osobe; moze byc ulamek — pol etatu to 0,5)
  // i czyje zadania nie wchodza do limitu. Patrz .env.example.
  // Przecinek tez: „3,5" (tak liczbe pokazuje aplikacja) dawalo NaN i po cichu domyslne 3.5.
  const devsRaw = Number(String(env.BX_CAPACITY_DEVS ?? '').trim().replace(',', '.'));
  const capacityDevs = Number.isFinite(devsRaw) && devsRaw > 0 ? devsRaw : 3.5;
  const capacityExcludeIds = (env.BX_CAPACITY_EXCLUDE_IDS || '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);

  return {
    name: 'bitrix-proxy',
    configureServer(server) {
      if (!webhook) {
        server.config.logger.warn(
          '\n[bitrix] Brak BITRIX_WEBHOOK w .env — aplikacja wystartuje, ale kazde zapytanie zwroci 500.\n' +
            '         Skopiuj .env.example do .env i wklej URL webhooka.\n',
        );
      }

      // Konfiguracja bez sekretu — front musi znac groupId i "kim jestem",
      // ale nie token. userId czytamy z samego URL-a webhooka (/rest/<uid>/<token>/).
      // groupId to juz tylko wartosc DOMYSLNA: projekt wybrany w aplikacji
      // (localStorage) ma pierwszenstwo, wiec .env decyduje o pierwszym starcie.
      const userId = webhook.match(/\/rest\/(\d+)\//)?.[1] ?? null;
      // Adres portalu bierzemy z webhooka — zeby nie wpisywac domeny na sztywno w UI.
      const portal = webhook.match(/^(https?:\/\/[^/]+)/)?.[1] ?? null;

      server.middlewares.use('/api/config', (_req, res) => {
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            groupId,
            userId,
            portal,
            unassignedId,
            itDepartments,
            itUsers,
            capacityDevs,
            capacityExcludeIds,
            configured: Boolean(webhook),
          }),
        );
      });

      /**
       * Wersja lokalnej kopii czytana NA ZYWO (przy kazdym zapytaniu), nie zapamietana
       * przy starcie — inaczej po `git pull` + HMR wartosc byłaby nieaktualna i baner
       * „nowa wersja" wisialby w kolko. `repo`/`branch` tez z gita, bez zaszywania nazwy.
       * Puste pola, gdy `git` niedostepny — front wtedy po prostu nie sprawdza.
       */
      /**
       * HTML -> PDF przez przegladarke headless (Edge / Chrome sa na kazdym biurkowym komputerze), bez
       * dodatkowych zaleznosci. Przyjmuje gotowy dokument HTML w ciele, oddaje bajty PDF. Dziala lokalnie
       * (serwer deweloperski); bez przegladarki odpowiada 501, a front zapisuje wtedy zwykly plik HTML.
       */
      /*
       * Zabezpieczenia: tylko z aplikacji (sameOrigin), do 15 MB, jeden PDF naraz (kolejka najwyzej 3 —
       * kazdy to osobna przegladarka headless), a dokument dostaje CSP: bez skryptow i bez plikow z dysku
       * (strona otwiera sie z file://, wiec bez tego <img src="file:///..."> wydrukowalby dowolny plik).
       * Obrazki, style i fonty tylko z adresu aplikacji (snapshotHtml ustawia <base> na niego), data: i https.
       */
      let pdfQueue = Promise.resolve();
      let pdfWaiting = 0;
      server.middlewares.use('/api/pdf', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        if (!sameOrigin(req)) {
          res.statusCode = 403;
          res.end('PDF tylko z aplikacji.');
          return;
        }
        const browser = findPdfBrowser(env.BX_PDF_BROWSER);
        if (!browser) {
          res.statusCode = 501;
          res.end('Brak przegladarki do generowania PDF (ustaw BX_PDF_BROWSER).');
          return;
        }
        let html: string;
        try {
          html = await readBody(req, 15 * 1024 * 1024);
        } catch (e) {
          res.statusCode = e instanceof BodyTooLarge ? 413 : 400;
          res.end(e instanceof BodyTooLarge ? 'Dokument za duzy (max 15 MB).' : 'Blad odczytu.');
          return;
        }
        const locked = withCsp(html, req.headers.host);
        if (locked === null) {
          res.statusCode = 400;
          res.end('Oczekiwany dokument HTML z <head>.');
          return;
        }
        html = locked;
        if (pdfWaiting >= 3) {
          res.statusCode = 429;
          res.end('Za duzo PDF-ow naraz — sprobuj za chwile.');
          return;
        }
        pdfWaiting++;
        const job = pdfQueue.then(async () => {
          const dir = await mkdtemp(join(tmpdir(), 'binear-pdf-'));
          try {
            const input = join(dir, 'in.html');
            const output = join(dir, 'out.pdf');
            await writeFile(input, html, 'utf8');
            await run(
              browser,
              [
                '--headless=new',
                '--disable-gpu',
                '--no-pdf-header-footer',
                `--user-data-dir=${join(dir, 'profile')}`,
                `--print-to-pdf=${output}`,
                pathToFileURL(input).href,
              ],
              { timeout: 60_000 },
            );
            return await readFile(output);
          } finally {
            await rm(dir, { recursive: true, force: true }).catch(() => {});
          }
        });
        pdfQueue = job.then(
          () => {},
          () => {},
        );
        try {
          const pdf = await job;
          res.setHeader('content-type', 'application/pdf');
          res.end(pdf);
        } catch (e) {
          res.statusCode = 500;
          res.end(e instanceof Error ? e.message : 'blad generowania PDF');
        } finally {
          pdfWaiting--;
        }
      });

      /*
       * Zespol i grafik (okno „Zespół i grafik") — jeden plik na serwerze, wspolny dla wszystkich, ktorzy uzywaja
       * tej instancji, osobno dla kazdego projektu: { "<groupId>": { members, off } }. Wczesniej siedzial tylko
       * w przegladarce, wiec kazdy mial wlasny zespol i wlasne moce. Ostatni zapis wygrywa.
       * Zapis tylko z tej samej strony (Origin == Host) — inaczej dowolna otwarta strona moglaby nadpisac zespol.
       */
      const teamFile = resolve(process.cwd(), env.BX_TEAM_FILE || 'binear-team.json');
      /*
       * `strict` (zapis): tylko brak pliku znaczy „pusto". Uszkodzony albo nieczytelny plik rzuca — inaczej zapis
       * jednego projektu nadpisalby go samym sobą i skasowal zespoly wszystkich pozostalych.
       */
      const readTeams = async (strict = false): Promise<Record<string, unknown>> => {
        let text: string | null;
        try {
          text = await readFile(teamFile, 'utf8');
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'ENOENT' && strict) throw e;
          text = null;
        }
        return parseTeams(text, strict);
      };
      let teamWrite = Promise.resolve();
      server.middlewares.use('/api/team', async (req, res) => {
        const group = (req.url || '').replace(/^\//, '').split('?')[0];
        res.setHeader('content-type', 'application/json');
        if (!/^\d+$/.test(group)) {
          res.statusCode = 400;
          res.end('{"error":"zly projekt"}');
          return;
        }
        if (req.method === 'GET') {
          const teams = await readTeams();
          res.end(JSON.stringify({ team: teams[group] ?? null }));
          return;
        }
        if (req.method !== 'PUT') {
          res.statusCode = 405;
          res.end('{"error":"tylko GET i PUT"}');
          return;
        }
        if (!sameOrigin(req)) {
          res.statusCode = 403;
          res.end('{"error":"zapis tylko z aplikacji"}');
          return;
        }
        let team: unknown;
        try {
          team = JSON.parse(await readBody(req, 256 * 1024));
          if (!team || typeof team !== 'object' || !Array.isArray((team as { members?: unknown }).members)) throw new Error();
        } catch {
          res.statusCode = 400;
          res.end('{"error":"zly zespol"}');
          return;
        }
        // Zapisy po kolei i przez plik tymczasowy: dwa naraz nie zgubia sie nawzajem ani nie zostawia polowy pliku.
        const job = teamWrite.then(async () => {
          const teams = await readTeams(true);
          teams[group] = team;
          const tmp = `${teamFile}.${process.pid}.tmp`;
          await writeFile(tmp, JSON.stringify(teams, null, 2) + '\n', 'utf8');
          await rename(tmp, teamFile);
        });
        teamWrite = job.catch(() => {});
        try {
          await job;
          res.end('{"ok":true}');
        } catch (e) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : 'blad zapisu' }));
        }
      });

      server.middlewares.use('/api/version', async (_req, res) => {
        const git = async (args: string[]): Promise<string> => {
          try {
            const { stdout } = await run('git', args, { cwd: process.cwd() });
            return stdout.trim();
          } catch {
            return '';
          }
        };
        /*
         * Galaz NA GITHUBIE, za ktora idzie lokalna (upstream z origin), a nie lokalna nazwa — lokalna galaz bez
         * odpowiednika (np. przegladany PR) dawala 422 z GitHuba przy kazdym sprawdzeniu. Bez upstreamu: pusto,
         * front wtedy nie sprawdza.
         */
        const [sha, remote, upstream] = await Promise.all([
          git(['rev-parse', 'HEAD']),
          git(['config', '--get', 'remote.origin.url']),
          git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']),
        ]);
        const repo = remote.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/i)?.[1] ?? '';
        const branch = upstream.startsWith('origin/') ? upstream.slice('origin/'.length) : '';
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ sha, repo, branch }));
      });

      /**
       * Jednoklikowa aktualizacja: `git pull --ff-only` po stronie serwera (przegladarka
       * nie ma dostepu do gita). Vite obserwuje pliki, wiec zaraz po pobraniu robi HMR
       * i aplikacja odswieza sie z nowym kodem — uzytkownik tylko klika w baner.
       *
       * `--ff-only` swiadomie ODMAWIA, gdy sa lokalne zmiany albo trzeba merge'a — nic
       * nie nadpisujemy; wtedy front pokazuje instrukcje recznego `git pull`. Endpoint
       * istnieje tylko w dev-serwerze i slucha na localhoscie (maszyna uzytkownika).
       */
      server.middlewares.use('/api/update', async (req, res) => {
        const send = (status: number, payload: unknown) => {
          res.statusCode = status;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(payload));
        };

        if (req.method !== 'POST') return send(405, { ok: false, message: 'Tylko POST' });
        if (!sameOrigin(req)) return send(403, { ok: false, message: 'Aktualizacja tylko z samej aplikacji' });

        try {
          const { stdout, stderr } = await run('git', ['pull', '--ff-only'], { cwd: process.cwd() });
          const out = `${stdout}${stderr}`.trim();
          const upToDate = /already up[- ]to[- ]date/i.test(out);
          send(200, { ok: true, updated: !upToDate, message: out });
        } catch (err: any) {
          // Nie-zerowy git (brudne drzewo / brak ff / brak sieci / brak gita) — obsluzone,
          // nie 500: front ma pokazac powod i podpowiedziec reczny pull.
          const message = String(err?.stderr || err?.stdout || err?.message || err).trim();
          send(200, { ok: false, message });
        }
      });

      /**
       * Plik z Dysku Bitriksa, przepuszczony przez SERWER. `/api/file/<id>` oddaje
       * same bajty, wiec da sie go wstawic wprost w `<img src>`.
       *
       * Dlaczego nie linkowac do Bitriksa bezposrednio — obie drogi sa nie do uzycia
       * w przegladarce, kazda z innego powodu:
       *  - `DOWNLOAD_URL` z `disk.file.get` prowadzi przez `/rest/<uid>/<token>/`,
       *    czyli NIESIE TOKEN WEBHOOKA. Wstawienie go w `src` oddaloby przegladarce
       *    pelny dostep do portalu — dokladnie to, czemu zapobiega cale to proxy.
       *  - `urlShow` z `im.dialog.messages.get` tokenu nie ma (jest podpis), ale bez
       *    sesji w Bitriksie oddaje 302 na logowanie. Dzialaloby tylko zalogowanym.
       *
       * Sciezka przyjmuje WYLACZNIE liczbe. To nie jest allowlista metod jak nizej,
       * tylko jedno, waskie przejscie: identyfikator pliku i nic wiecej.
       */
      server.middlewares.use('/api/file/', async (req, res) => {
        const id = (req.url || '').replace(/^\//, '').split('?')[0];
        if (!/^\d+$/.test(id)) {
          res.statusCode = 400;
          return res.end('zly identyfikator pliku');
        }
        if (!webhook) {
          res.statusCode = 500;
          return res.end('BITRIX_WEBHOOK nie jest ustawiony');
        }

        try {
          const meta = await fetch(`${webhook}/disk.file.get.json`, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: `id=${id}`,
          }).then((r) => r.json());

          const url = meta?.result?.DOWNLOAD_URL;
          if (!url) {
            res.statusCode = 404;
            return res.end('nie ma takiego pliku');
          }
          const name = String(meta?.result?.NAME ?? '');

          const file = await fetch(url);
          if (!file.ok || !file.body) {
            res.statusCode = file.status || 502;
            return res.end('Bitrix odmowil pliku');
          }

          res.statusCode = 200;
          res.setHeader('content-type', file.headers.get('content-type') ?? 'application/octet-stream');
          if (name) res.setHeader('content-disposition', contentDisposition(name));
          const len = file.headers.get('content-length');
          if (len) res.setHeader('content-length', len);
          /*
           * Bajty pliku sie NIE ZMIENIAJA — `id` wskazuje konkretna wersje na Dysku,
           * a nowa wersja dostaje nowy numer. Stad `immutable` i rok zamiast godziny:
           * bez tego przegladarka po godzinie sciagala zalacznik od nowa, a przy
           * kazdym twardym odswiezeniu ignorowala cache calkowicie. `ETag` domyka
           * sprawe — po wygasnieciu wystarczy 304 zamiast calych bajtow.
           */
          res.setHeader('etag', `"disk-${id}"`);
          res.setHeader('cache-control', 'private, max-age=31536000, immutable');
          res.end(Buffer.from(await file.arrayBuffer()));
        } catch (err) {
          res.statusCode = 502;
          res.end(err instanceof Error ? err.message : String(err));
        }
      });

      /**
       * Zalacznik zadania. Osobna trasa od `/api/file/`, bo to INNA przestrzen
       * identyfikatorow i inna metoda:
       *  - `/api/file/<id>`  -> `disk.file.get`, plik na Dysku (tak przychodza pliki z czatu),
       *  - `/api/attach/<id>` -> `disk.attachedObject.get`, rekord DOCZEPIENIA pliku do zadania.
       *
       * Rozdzial nie jest kosmetyczny: `disk.file.get` oddaje ACCESS_DENIED dla plikow,
       * ktore webhookowy uzytkownik widzi wylacznie POPRZEZ zadanie (sprawdzone na
       * 437269 i 438225), a `disk.attachedObject.get` dla tych samych plikow dziala.
       * Zgadywanie po jednym identyfikatorze konczyloby sie polowa martwych obrazkow.
       */
      server.middlewares.use('/api/attach/', async (req, res) => {
        const id = (req.url || '').replace(/^\//, '').split('?')[0];
        if (!/^\d+$/.test(id)) {
          res.statusCode = 400;
          return res.end('zly identyfikator zalacznika');
        }
        if (!webhook) {
          res.statusCode = 500;
          return res.end('BITRIX_WEBHOOK nie jest ustawiony');
        }

        try {
          const meta = await fetch(`${webhook}/disk.attachedObject.get.json`, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: `id=${id}`,
          }).then((r) => r.json());

          const url = meta?.result?.DOWNLOAD_URL;
          if (!url) {
            res.statusCode = 404;
            return res.end('nie ma takiego zalacznika');
          }
          const name = String(meta?.result?.NAME ?? '');

          const file = await fetch(url);
          if (!file.ok) {
            res.statusCode = file.status || 502;
            return res.end('Bitrix odmowil pliku');
          }

          res.statusCode = 200;
          res.setHeader('content-type', file.headers.get('content-type') ?? 'application/octet-stream');
          if (name) res.setHeader('content-disposition', contentDisposition(name));
          /* Jak przy plikach z Dysku wyzej: doczepienie wskazuje konkretna wersje,
             wiec bajty sa niezmienne i nie ma po co ich pobierac drugi raz. */
          res.setHeader('etag', `"att-${id}"`);
          res.setHeader('cache-control', 'private, max-age=31536000, immutable');
          res.end(Buffer.from(await file.arrayBuffer()));
        } catch (err) {
          res.statusCode = 502;
          res.end(err instanceof Error ? err.message : String(err));
        }
      });

      server.middlewares.use('/api/bx/', async (req, res) => {
        const send = (status: number, payload: unknown) => {
          res.statusCode = status;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(payload));
        };

        const method = (req.url || '').replace(/^\//, '').split('?')[0];

        if (!webhook) return send(500, { error: 'BITRIX_WEBHOOK nie jest ustawiony w .env' });
        if (!ALLOWED.has(method)) return send(403, { error: `Metoda spoza allowlisty: ${method}` });
        // Inna otwarta strona nie moze wolac Bitriksa naszym webhookiem (prosty POST text/plain przechodzi bez CORS).
        if (!sameOrigin(req)) return send(403, { error: 'Zapytanie spoza aplikacji' });

        try {
          const raw = await readBody(req);
          const params = raw ? JSON.parse(raw) : {};
          // Wywolania w `batch` przechodza te sama allowliste (patrz `batchViolation`).
          if (method === 'batch') {
            const bad = batchViolation(params);
            if (bad) return send(403, { error: bad });
          }
          const body = encodeParams(params).join('&');

          const upstream = await fetch(`${webhook}/${method}.json`, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body,
          });

          const text = await upstream.text();
          res.statusCode = upstream.ok ? 200 : upstream.status;
          res.setHeader('content-type', 'application/json');
          res.end(text);
        } catch (err) {
          send(502, { error: err instanceof Error ? err.message : String(err) });
        }
      });
    },
  };
}
