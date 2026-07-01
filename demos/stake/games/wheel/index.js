// Wheel — spin a ring of multipliers.
import { registry } from '../../core/registry.js';
import { logic } from './logic.js';
import { create } from './ui.js';

export const def = {
  id: 'wheel', name: 'Wheel', tagline: 'Spin the multiplier ring',
  icon: 'loader', accent: '#3aa0ff', category: 'Originals', houseEdge: 0.02,
  rules: [
    'Choose the number of segments and the risk level, set your bet, then spin.',
    'The pointer lands on one segment (provably fair). You win your bet × that segment’s multiplier.',
    'Some segments pay 0× (a loss). Higher risk means more zero segments but much bigger multipliers on the rest.',
    'Multiplier tables are scaled to a 2% house edge for any segment/risk combination.',
  ],
  logic, create,
};
registry.register(def);
