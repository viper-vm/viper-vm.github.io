// Crash — cash out before the multiplier busts.
import { registry } from '../../core/registry.js';
import { logic } from './logic.js';
import { create } from './ui.js';

export const def = {
  id: 'crash', name: 'Crash', tagline: 'Cash out before it busts',
  icon: 'rocket', accent: '#ff5c8a', category: 'Originals', houseEdge: 0.01,
  logic, create,
};
registry.register(def);
