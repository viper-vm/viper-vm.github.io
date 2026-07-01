// Keno — pick numbers, match the draw.
import { registry } from '../../core/registry.js';
import { logic } from './logic.js';
import { create } from './ui.js';

export const def = {
  id: 'keno', name: 'Keno', tagline: 'Pick numbers, match the draw',
  icon: 'grid-3x3', accent: '#22d3a6', category: 'Originals', houseEdge: 0.03,
  logic, create,
};
registry.register(def);
