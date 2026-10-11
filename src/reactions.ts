/*
 * Reakcje na komentarze w czacie zadania — te same, ktore daje Bitrix.
 *
 * Kody to nazwy z `im.v2.Chat.Message.Reaction.*` (sprawdzone na portalu: kazdy z listy nizej
 * przechodzi przez `Reaction.add`, a np. `heart` czy `thumbsUp` dostaja REACTION_NOT_FOUND).
 * Stare `im.dialog.messages.get` zna tylko „lajki" (`params.LIKE`) bez rodzaju — dlatego reakcje
 * czytamy z metod v2, patrz `fetchChatReactions` w bitrix.ts.
 */

export interface CommentReaction {
  /** Kod Bitriksa, np. `like`, `redHeart`, `faceWithTearsOfJoy`. */
  code: string;
  /** Kto dal te reakcje — numery uzytkownikow. */
  users: number[];
}

/** Kolejnosc = kolejnosc w okienku wyboru. Najczestsze na poczatku. */
export const REACTIONS: { code: string; emoji: string }[] = [
  { code: 'like', emoji: '👍' },
  { code: 'redHeart', emoji: '❤️' },
  { code: 'faceWithTearsOfJoy', emoji: '😂' },
  { code: 'fire', emoji: '🔥' },
  { code: 'eyes', emoji: '👀' },
  { code: 'foldedHands', emoji: '🙏' },
  { code: 'clappingHands', emoji: '👏' },
  { code: 'okHand', emoji: '👌' },
  { code: 'hundredPoints', emoji: '💯' },
  { code: 'thinkingFace', emoji: '🤔' },
  { code: 'flexedBiceps', emoji: '💪' },
  { code: 'handshake', emoji: '🤝' },
  { code: 'smilingFaceWithHeartEyes', emoji: '😍' },
  { code: 'smilingFaceWithSunglasses', emoji: '😎' },
  { code: 'slightlySmilingFace', emoji: '🙂' },
  { code: 'winkingFace', emoji: '😉' },
  { code: 'kiss', emoji: '😘' },
  { code: 'laugh', emoji: '😆' },
  { code: 'wonder', emoji: '😮' },
  { code: 'neutralFace', emoji: '😐' },
  { code: 'cry', emoji: '😢' },
  { code: 'loudlyCryingFace', emoji: '😭' },
  { code: 'angry', emoji: '😠' },
  { code: 'facepalm', emoji: '🤦' },
  { code: 'dislike', emoji: '👎' },
  { code: 'crossMark', emoji: '❌' },
];

const EMOJI = new Map(REACTIONS.map((r) => [r.code, r.emoji]));

/** Klucz w localStorage: ile razy na tym komputerze wybrano kazda reakcje. */
export const REACTIONS_USED_KEY = 'binear.reactions.used.v1';

/** Ile emoji w szybkim rzadku — reszta za „+". */
export const SZYBKIE = 6;

/**
 * Szybki rzadek: najczesciej uzywane na tym komputerze, a przy remisie (i na starcie, bez
 * historii) — kolejnosc z `REACTIONS`, czyli 👍 ❤️ 😂 🔥… Sort stabilny, wiec remis jej nie miesza.
 */
export function najczesciej(uzycia: Record<string, number>, ile = SZYBKIE): { code: string; emoji: string }[] {
  return [...REACTIONS].sort((a, b) => (uzycia[b.code] ?? 0) - (uzycia[a.code] ?? 0)).slice(0, ile);
}

/** Emoji dla kodu; nieznany kod (Bitrix dolozy nowy) pokazujemy jako sam kod, zamiast go gubic. */
export const emojiOf = (code: string): string => EMOJI.get(code) ?? code;

/**
 * Reakcje po kliknieciu: dodaje albo zdejmuje reakcje `me`. Pusta reakcja znika z listy, nowa
 * staje na koncu (tak jak w Bitriksie). Nie zmienia wejscia.
 */
export function toggleReaction(
  reactions: readonly CommentReaction[],
  code: string,
  me: number,
): CommentReaction[] {
  const at = reactions.findIndex((r) => r.code === code);
  if (at === -1) return [...reactions, { code, users: [me] }];
  const r = reactions[at];
  const users = r.users.includes(me) ? r.users.filter((u) => u !== me) : [...r.users, me];
  if (users.length === 0) return reactions.filter((_, i) => i !== at);
  return reactions.map((x, i) => (i === at ? { code, users } : x));
}

/** Reakcje z odpowiedzi v2 (`reactions[].reactionUsers`) — numer wiadomosci → lista reakcji. */
export function reactionsByMessage(raw: unknown): Map<number, CommentReaction[]> {
  const out = new Map<number, CommentReaction[]>();
  for (const r of Array.isArray(raw) ? raw : []) {
    const id = Number((r as any)?.messageId);
    const users = (r as any)?.reactionUsers;
    if (!Number.isFinite(id) || !users || typeof users !== 'object') continue;
    const lista = Object.entries(users as Record<string, unknown>)
      .map(([code, u]) => ({
        code,
        users: (Array.isArray(u) ? u : []).map(Number).filter((n) => Number.isFinite(n) && n > 0),
      }))
      .filter((x) => x.users.length > 0);
    if (lista.length) out.set(id, lista);
  }
  return out;
}
