/**
 * A basic profanity filter the host can switch off in Settings. It matches
 * whole words after undoing common character swaps (1→i, 0→o, @→a, $→s …)
 * and stretched letters ("shiiit"), and stars them out. It's deliberately
 * small: it stops the obvious stuff on a shared TV, it isn't a moderator.
 */
const WORDS = [
  'arse', 'arsehole', 'ass', 'asshole', 'bastard', 'bitch', 'bitches', 'bollocks', 'bullshit', 'cock', 'cocks',
  'cunt', 'cunts', 'dick', 'dickhead', 'dicks', 'fag', 'faggot', 'fuck', 'fucked', 'fucker', 'fuckers', 'fucking',
  'fucks', 'motherfucker', 'nigga', 'nigger', 'piss', 'pissed', 'prick', 'pussy', 'retard', 'retarded', 'shit',
  'shits', 'shitty', 'slut', 'sluts', 'twat', 'wank', 'wanker', 'whore', 'whores', 'dyke', 'spastic', 'tranny',
  'cum', 'jizz', 'tits', 'boner', 'dildo', 'rape', 'rapist', 'nazi', 'kike', 'chink', 'spic', 'wetback', 'paki',
];
const SET = new Set(WORDS);
const SWAPS: Record<string, string> = { '0': 'o', '1': 'i', '!': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', $: 's', '7': 't', '+': 't', '8': 'b', '9': 'g', '|': 'i' };

function canon(word: string): string {
  const swapped = [...word.toLowerCase()].map((c) => SWAPS[c] ?? c).join('').replace(/[^a-z]/g, '');
  return swapped;
}

function isBad(word: string): boolean {
  const c = canon(word);
  if (!c) return false;
  if (SET.has(c)) return true;
  // Squash repeats: "fuuuck" → "fuck", "shiiit" → "shit".
  const squashed = c.replace(/(.)\1+/g, '$1');
  if (SET.has(squashed)) return true;
  // A plural or -ing of a listed word.
  return SET.has(squashed.replace(/(s|es|ing|ed|er|ers)$/, ''));
}

/** Replace bad words with stars of the same length, keeping everything else. */
export function censor(text: string): string {
  return text.replace(/[\p{L}\p{N}@$!|+]+/gu, (w) => (isBad(w) ? '*'.repeat(w.length) : w));
}

export function hasProfanity(text: string): boolean {
  return censor(text) !== text;
}
