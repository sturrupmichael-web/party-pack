/**
 * The game registry. To add a game: write its logic (core/game.ts GameLogic)
 * and views, then list it here. The order here is the order in the picker.
 */
import type { GameModule } from '../core/game';
import { dialLogic } from './dial/logic';
import { dialViews } from './dial/views';
import { coverLogic } from './cover/logic';
import { coverViews } from './cover/views';
import { echoLogic } from './echo/logic';
import { echoViews } from './echo/views';
import { moleLogic } from './mole/logic';
import { moleViews } from './mole/views';
import { sauceLogic } from './sauce/logic';
import { sauceViews } from './sauce/views';
import { snackLogic } from './snack/logic';
import { snackViews } from './snack/views';
import { doodleLogic } from './doodle/logic';
import { doodleViews } from './doodle/views';
import { tumbleLogic } from './tumble/logic';
import { tumbleViews } from './tumble/views';
import { phishLogic } from './phish/logic';
import { phishViews } from './phish/views';
import { swatchLogic } from './swatch/logic';
import { swatchViews } from './swatch/views';

export const GAMES: GameModule[] = [
  { logic: moleLogic, views: moleViews, accent: '#b388ff', icon: '🕵️', available: true },
  { logic: echoLogic, views: echoViews, accent: '#4cc9f0', icon: '🔊', available: true },
  { logic: dialLogic, views: dialViews, accent: '#ffb703', icon: '🎛️', available: true },
  { logic: swatchLogic, views: swatchViews, accent: '#f15bb5', icon: '🎨', available: true },
  { logic: coverLogic, views: coverViews, accent: '#3ddc97', icon: '🗂️', available: true },
  { logic: sauceLogic, views: sauceViews, accent: '#ff4d6d', icon: '🌶️', available: true },
  { logic: snackLogic, views: snackViews, accent: '#ff8c42', icon: '🍱', available: true },
  { logic: doodleLogic, views: doodleViews, accent: '#a3e635', icon: '✏️', available: true },
  { logic: tumbleLogic, views: tumbleViews, accent: '#4cc9f0', icon: '🎲', available: true },
  { logic: phishLogic, views: phishViews, accent: '#ff4d6d', icon: '🎣', available: true },
];

export function gameById(id: string | null | undefined): GameModule | undefined {
  return GAMES.find((g) => g.logic.id === id);
}

/** Who plays this game: everyone seated, minus bots for games bots can't play. */
export function seatsFor<P extends { bot?: boolean }>(mod: GameModule, seatedPlayers: P[]): P[] {
  return mod.logic.bot ? seatedPlayers : seatedPlayers.filter((p) => !p.bot);
}
