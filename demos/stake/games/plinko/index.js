// Plinko — drop the ball, chase the edges.
import { registry } from '../../core/registry.js';
import { logic } from './logic.js';
import { create } from './ui.js';

export const def = {
  id: 'plinko', name: 'Plinko', tagline: 'Drop the ball, chase the edges',
  icon: 'circle-dot', accent: '#7c5cff', category: 'Originals', houseEdge: 0.01,
  logic, create,
};
registry.register(def);
