// Roulette — American double-zero wheel.
import { registry } from '../../core/registry.js';
import { logic } from './logic.js';
import { create } from './ui.js';

export const def = {
  id: 'roulette', name: 'Roulette', tagline: 'American double-zero wheel',
  icon: 'target', accent: '#e0b64d', category: 'Table', houseEdge: 2 / 38,
  rules: [
    'Pick a chip size, then click numbers or outside bets to place chips. Your total wager is all chips on the table.',
    'Press SPIN (hold it to open auto-spin). One provably-fair number lands from the 38 pockets (0, 00, 1–36).',
    'Payouts: straight number 35:1 · dozen or column 2:1 · red/black, odd/even, 1–18/19–36 all 1:1.',
    'The two green zeros (0 and 00) are what give the house its 5.26% edge — every outside bet loses on a zero.',
    'Rebet repeats your last bets, 2× doubles them, Undo/Clear adjust the table, Turbo speeds up the wheel.',
  ],
  logic, create,
};
registry.register(def);
