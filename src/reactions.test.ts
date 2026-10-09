import { describe, expect, it } from 'vitest';
import { emojiOf, najczesciej, reactionsByMessage, toggleReaction } from './reactions';

describe('toggleReaction', () => {
  it('nowa reakcja staje na koncu z jedna osoba', () => {
    expect(toggleReaction([{ code: 'like', users: [5] }], 'fire', 303)).toEqual([
      { code: 'like', users: [5] },
      { code: 'fire', users: [303] },
    ]);
  });

  it('dolacza do istniejacej reakcji, a drugie klikniecie ja zdejmuje', () => {
    const raz = toggleReaction([{ code: 'like', users: [5] }], 'like', 303);
    expect(raz).toEqual([{ code: 'like', users: [5, 303] }]);
    expect(toggleReaction(raz, 'like', 303)).toEqual([{ code: 'like', users: [5] }]);
  });

  it('reakcja bez nikogo znika z listy', () => {
    expect(toggleReaction([{ code: 'like', users: [303] }], 'like', 303)).toEqual([]);
  });
});

describe('reactionsByMessage', () => {
  it('czyta reactionUsers z odpowiedzi v2, puste reakcje pomija', () => {
    const m = reactionsByMessage([
      { messageId: 10, reactionUsers: { faceWithTearsOfJoy: [303], like: [] } },
      { messageId: 11, reactionUsers: { neutralFace: ['303', 7] } },
      { messageId: 'x' },
    ]);
    expect(m.get(10)).toEqual([{ code: 'faceWithTearsOfJoy', users: [303] }]);
    expect(m.get(11)).toEqual([{ code: 'neutralFace', users: [303, 7] }]);
    expect(m.size).toBe(2);
  });

  it('brak danych to pusta mapa, nie wyjatek', () => {
    expect(reactionsByMessage(undefined).size).toBe(0);
  });
});

describe('emojiOf', () => {
  it('znany kod to emoji, nieznany zostaje kodem', () => {
    expect(emojiOf('redHeart')).toBe('❤️');
    expect(emojiOf('nowaReakcja')).toBe('nowaReakcja');
  });
});

describe('najczesciej', () => {
  it('bez historii: 👍 ❤️ 😂 🔥 👀 🙏', () => {
    expect(najczesciej({}).map((r) => r.emoji)).toEqual(['👍', '❤️', '😂', '🔥', '👀', '🙏']);
  });

  it('czesciej wybierane wchodza na poczatek, reszta w zwyklej kolejnosci', () => {
    expect(najczesciej({ facepalm: 3, fire: 1 }).map((r) => r.code)).toEqual([
      'facepalm',
      'fire',
      'like',
      'redHeart',
      'faceWithTearsOfJoy',
      'eyes',
    ]);
  });
});
