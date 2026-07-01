// Keno — pick numbers, match the draw.
import { registry } from '../../core/registry.js';
import { logic } from './logic.js';
import { create } from './ui.js';

export const def = {
  id: 'keno', name: 'Keno', tagline: 'Pick numbers, match the draw',
  icon: 'grid-3x3', accent: '#22d3a6', category: 'Originals', houseEdge: 0.03,
  rules: [
    'Pick 1–10 numbers from the grid of 40 (or use Quick Pick).',
    'Ten numbers are then drawn provably-fair. Your payout depends on how many of your picks hit.',
    'The paytable under the grid shows the multiplier for each hit count — matching all your picks is the jackpot.',
    'Picking more numbers spreads the payouts differently; the top prizes grow but need more hits. House edge 3%.',
  ],
  logic, create,
};
registry.register(def);
