// Roulette — American double-zero wheel.
import { registry } from '../../core/registry.js';
import { logic } from './logic.js';
import { create } from './ui.js';

export const def = {
  id: 'roulette', name: 'Roulette', tagline: 'American double-zero wheel',
  icon: 'target', accent: '#e0b64d', category: 'Table', houseEdge: 2 / 38,
  logic, create,
};
registry.register(def);
