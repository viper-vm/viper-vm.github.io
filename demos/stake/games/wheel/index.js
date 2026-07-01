// Wheel — spin a ring of multipliers.
import { registry } from '../../core/registry.js';
import { logic } from './logic.js';
import { create } from './ui.js';

export const def = {
  id: 'wheel', name: 'Wheel', tagline: 'Spin the multiplier ring',
  icon: 'loader', accent: '#3aa0ff', category: 'Originals', houseEdge: 0.02,
  logic, create,
};
registry.register(def);
