/**
 * The game registry. To add a game: write its logic (core/game.ts GameLogic)
 * and views, then list it here. The order here is the order in the picker.
 */
import type { GameModule } from '../core/game';
import { phishLogic } from './phish/logic';
import { phishViews } from './phish/views';

/** Placeholder for games that arrive in a later phase. */
function comingSoon(id: string, title: string, tagline: string, icon: string, accent: string): GameModule {
  return {
    logic: { id, title, tagline, minPlayers: 3, maxPlayers: 8 } as GameModule['logic'],
    views: null as unknown as GameModule['views'],
    accent,
    icon,
    available: false,
  };
}

export const GAMES: GameModule[] = [
  { logic: phishLogic, views: phishViews, accent: '#ff4d6d', icon: '🎣', available: true },
  comingSoon('excuse', 'Excuse Engine', 'Write the worst excuses in IT. Win the vote.', '🛠️', '#ffb703'),
  comingSoon('acronym', 'Acronym Bluff', 'Invent fake meanings for real tech acronyms.', '🔤', '#4cc9f0'),
  comingSoon('sketch', 'Ticket Sketch', 'Draw the ticket. Guess the ticket.', '✏️', '#3ddc97'),
];

export function gameById(id: string | null | undefined): GameModule | undefined {
  return GAMES.find((g) => g.logic.id === id);
}
