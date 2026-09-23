/**
 * Cytat w komentarzu zadania — czyli to, czym w Bitriksie jest ODPOWIEDZ.
 *
 * Bitrix nie ma dla odpowiedzi osobnego pola. Klikniecie „odpowiedz" wkleja
 * cytowana wiadomosc wprost w tresc nowej, miedzy dwie linie myslnikow:
 *
 *     ------------------------------------------------------
 *     Damian Chwiejczak [wczoraj, 22:26] #chat23455/5868373
 *     cytowany tekst
 *     ------------------------------------------------------
 *     wlasna odpowiedz
 *
 * Naglowek bywa pominiety — przy cytacie z zaznaczenia zostaje sam tekst w
 * cudzyslowie. Odnosnik `#chatID/msgID` to wewnetrzna kotwica Bitriksa; dla
 * czytelnika nic nie znaczy, wiec do wyswietlenia go nie bierzemy.
 *
 * Bez tego rozbicia komentarz z odpowiedzia wyswietlal sie doslownie, razem z
 * kreskami i odnosnikiem, i nie dalo sie odroznic cudzych slow od wlasnych.
 */
export interface Quote {
  /** Autor cytowanej wiadomosci, gdy Bitrix go dopisal. */
  author: string | null;
  /** Kiedy — tak, jak zapisal to Bitrix („wczoraj, 22:26"). */
  when: string | null;
  /** Sama cytowana tresc. */
  body: string;
}

/** Linia oddzielajaca cytat: co najmniej kilkanascie myslnikow i nic wiecej. */
const RULE = /^-{10,}$/;

/**
 * „Damian Chwiejczak [wczoraj, 22:26] #chat23455/5868373"
 *
 * W nawiasie MUSI stac godzina. Bez tego warunku naglowkiem stawala sie kazda
 * linia konczaca sie nawiasem kwadratowym — np. „Poprawka [zrobione]" na
 * poczatku cytowanej tresci. Taka linia byla wtedy zjadana jako naglowek
 * i znikala z cytatu.
 *
 * Kotwica `#chatID/msgID` zostaje NIEOBOWIAZKOWA: Bitrix ja dopisuje, ale
 * `buildQuote` (cytat zlozony przez binear) juz nie — gdyby byla wymagana,
 * wlasne odpowiedzi przestalyby sie rozbijac.
 */
const HEAD = /^(.+?)\s*\[([^\]]*\d{1,2}:\d{2}[^\]]*)\]\s*(?:#chat\d+\/\d+)?\s*$/;

/**
 * Dzieli tresc komentarza na cytat i wlasciwa odpowiedz.
 *
 * Gdy cytatu nie ma, `quote` jest `null`, a `rest` to niezmieniony tekst — to
 * najczestszy przypadek i nie wolno go w zaden sposob przerabiac.
 *
 * `raw` to cytat DOKLADNIE tak, jak stoi w tresci — z kreskami i z wewnetrzna
 * kotwica `#chatID/msgID`, ktorej `quote` nie niesie. Potrzebny przy EDYCJI:
 * zmieniamy sama odpowiedz i doklejamy cytat z powrotem bez zmian. Skladanie go
 * na nowo przez `buildQuote` gubiloby kotwice, czyli po kazdej poprawce literowki
 * komentarz traciloby powiazanie z oryginalem po stronie Bitriksa.
 */
export function splitQuote(text: string): { quote: Quote | null; rest: string; raw: string } {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (!RULE.test(lines[0]?.trim() ?? '')) return { quote: null, rest: text, raw: '' };

  /* Zamykajaca kreska. Bez niej cytat nie ma konca i lepiej zostawic tekst
     w spokoju, niz zgadywac, gdzie sie urywa. */
  const end = lines.findIndex((l, i) => i > 0 && RULE.test(l.trim()));
  if (end === -1) return { quote: null, rest: text, raw: '' };

  const inner = lines.slice(1, end);
  const m = inner.length ? HEAD.exec(inner[0].trim()) : null;
  const body = (m ? inner.slice(1) : inner).join('\n').trim();

  /*
   * Cytat z zaznaczenia przychodzi w cudzyslowie — zdejmujemy go, bo cudzyslow
   * niesie tu to samo, co niesie juz sam ksztalt cytatu.
   *
   * Tylko gdy w srodku nie ma innego cudzyslowu: dla `"a" oraz "b"` poprzednia
   * wersja scinala pierwszy i ostatni znak, robiac `a" oraz "b`. Zachlanne
   * `[\s\S]*` siegalo do OSTATNIEGO cudzyslowu w tekscie, nie do pary.
   */
  const unquoted = (/^"[^"]*"$/.test(body) ? body.slice(1, -1) : body).trim();

  return {
    quote: { author: m ? m[1].trim() : null, when: m ? m[2].trim() : null, body: unquoted },
    rest: lines.slice(end + 1).join('\n').trim(),
    raw: `${lines.slice(0, end + 1).join('\n')}\n`,
  };
}

/** Sklada cytat W FORMACIE BITRIKSA — zeby odpowiedz z binear wygladala tam tak samo. */
export function buildQuote(author: string, when: string, body: string): string {
  const rule = '-'.repeat(54);
  return `${rule}\n${author} [${when}]\n${body}\n${rule}\n`;
}

/**
 * Tresc bez znacznikow Bitriksa — do PODGLADU w jednej linii.
 *
 * W pasku odpowiedzi nie ma miejsca na pelne renderowanie, a surowe
 * `[USER=387]Anna[/USER]` czy `[URL=...]` czytaja sie jak przypadkowy kod.
 * Do wlasciwej tresci komentarza to NIE jest droga — tam idzie pelny parser.
 */
export function plainText(text: string): string {
  return text
    .replace(/\[USER=\d+\]([^[]*)\[\/USER\]/g, '$1')
    .replace(/\[URL=[^\]]*\]([^[]*)\[\/URL\]/g, '$1')
    .replace(/\[TIMESTAMP=\d+\]/g, '')
    .replace(/\[\/?[A-Z]+(=[^\]]*)?\]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}
