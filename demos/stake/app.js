// ============================================================
//  Bootstrap — wire the engine, register games, mount the shell.
//  Everything runs client-side; no backend (static host).
// ============================================================

import { bus } from './core/bus.js';
import { betStore } from './core/store.js';
import { ProvablyFair } from './core/rng.js';
import { Wallet } from './core/wallet.js';
import { AnalyticsEngine } from './core/analytics.js';
import { Router } from './core/router.js';
import { buildShell } from './ui/shell.js';

// Register games (import side-effects call registry.register()).
import './games/dice.js';
import './games/limbo.js';
import './games/mines.js';
import './games/roulette.js';

async function main() {
  const store = await betStore();
  const [fair, wallet, analytics] = await Promise.all([
    new ProvablyFair(bus).init(),
    new Wallet(bus).init(),
    new AnalyticsEngine(bus).init(),
  ]);

  const env = { bus, store, fair, wallet, analytics, router: null };
  const shell = buildShell(env);
  const router = new Router((route) => shell.renderRoute(route));
  env.router = router;
  router.start();

  // expose for debugging / verification
  window.__stake = env;
  if (store.degraded) {
    bus.emit('toast', { message: 'Storage unavailable — history won’t persist this session', tone: 'warn', ttl: 5000 });
  }
}

main().catch((err) => {
  console.error('[stake] failed to start', err);
  document.body.innerHTML =
    '<div style="max-width:640px;margin:4rem auto;font-family:system-ui;color:#cfe3ee;background:#122735;padding:2rem;border-radius:12px">' +
    '<h2>Couldn’t start the simulator</h2><pre style="white-space:pre-wrap">' + (err && err.message) + '</pre></div>';
});
