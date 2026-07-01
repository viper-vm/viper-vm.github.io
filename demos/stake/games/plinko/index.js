// Plinko — drop the ball, chase the edges.
import { registry } from '../../core/registry.js';
import { logic } from './logic.js';
import { create } from './ui.js';

export const def = {
  id: 'plinko', name: 'Plinko', tagline: 'Drop the ball, chase the edges',
  icon: 'circle-dot', accent: '#7c5cff', category: 'Originals', houseEdge: 0.01,
  rules: [
    'Set your bet, rows (8/12/16) and risk, then drop the ball.',
    'At every peg the ball bounces left or right on a provably-fair coin flip. Where it lands sets your multiplier.',
    'The outer slots pay the biggest multipliers but are hit rarely; the centre slots pay under 1× and are hit often.',
    'More rows and higher risk = more volatile (bigger edges, smaller centre). House edge 1%.',
  ],
  logic, create,
};
registry.register(def);
