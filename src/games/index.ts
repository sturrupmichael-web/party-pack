/**
 * The game registry. To add a game: write its logic (core/game.ts GameLogic)
 * and views, then list it here. The order here is the order in the picker.
 */
import type { GameModule } from '../core/game';
import { dialLogic } from './dial/logic';
import { dialViews } from './dial/views';
import { echoLogic } from './echo/logic';
import { echoViews } from './echo/views';
import { moleLogic } from './mole/logic';
import { moleViews } from './mole/views';
import { phishLogic } from './phish/logic';
import { phishViews } from './phish/views';

/** Placeholder for games that arrive in a later chunk. */
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
  { logic: moleLogic, views: moleViews, accent: '#b388ff', icon: '🕵️', available: true },
  { logic: echoLogic, views: echoViews, accent: '#4cc9f0', icon: '🔊', available: true },
  { logic: dialLogic, views: dialViews, accent: '#ffb703', icon: '🎛️', available: true },
  comingSoon('swatch', 'Swatch Watch', 'Clue a colour. Everyone hunts for it on the grid.', '🎨', '#f15bb5'),
  comingSoon('cover', 'Cover Story', 'Two teams, one grid of words, two code-givers.', '🗂️', '#3ddc97'),
  comingSoon('sauce', 'Hot Sauce', 'Bid on cups, and pray none of them is the hot one.', '🌶️', '#ff4d6d'),
  comingSoon('snack', 'Snack Swap', 'Pick a snack, pass the rest. Build the best spread.', '🍱', '#ff8c42'),
  comingSoon('doodle', 'Doodle Relay', 'Draw it, guess it, draw the guess. Watch it go wrong.', '✏️', '#a3e635'),
  comingSoon('tumble', 'Tumble Steps', 'Flick dice down the stairs. Aim and power from your phone.', '🎲', '#4cc9f0'),
  { logic: phishLogic, views: phishViews, accent: '#ff4d6d', icon: '🎣', available: true },
];

export function gameById(id: string | null | undefined): GameModule | undefined {
  return GAMES.find((g) => g.logic.id === id);
}
