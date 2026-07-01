// Crash — cash out before the multiplier busts.
import { registry } from '../../core/registry.js';
import { logic } from './logic.js';
import { create } from './ui.js';

export const def = {
  id: 'crash', name: 'Crash', tagline: 'Cash out before it busts',
  icon: 'rocket', accent: '#ff5c8a', category: 'Originals', houseEdge: 0.01,
  rules: [
    'Place a bet and the multiplier starts climbing from 1.00×.',
    'Hit Cash Out before it busts to win your bet × the multiplier at that instant.',
    'Set an Auto Cash-out to lock in automatically at a target — if the crash point is below it, you lose.',
    'The crash point is provably fair: crash = (1 − edge) ÷ (1 − r). House edge 1%.',
    'Auto mode runs many fast rounds cashing out at your target, with progressions and stop conditions.',
  ],
  logic, create,
};
registry.register(def);
