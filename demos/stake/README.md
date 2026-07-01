# Stake — Casino Simulator (hidden demo)

A free, **provably-fair casino simulator** that plays entirely in **fake USD**. No real money,
nothing redeemable — it exists to play risk-free and to *study the math* of betting: house edge,
variance, RTP, and how betting systems actually behave over thousands of rounds.

> **Unlisted.** This demo is intentionally **not** in `assets/data/demos.json`, so it never shows
> on the portfolio or the `/demos/` grid. It carries `<meta name="robots" content="noindex,nofollow">`
> and is reachable only by direct URL: **`/demos/stake/`**.

## Why it's built this way

The site is a **static GitHub Pages host** — no backend. So the whole thing is **client-side**:
vanilla ES modules (no build step), the **Web Crypto API** for provably-fair RNG, **IndexedDB**
for the durable bet history that analytics is rebuilt from, and **localStorage** for small state
(wallet, seeds, settings, saved strategies). Zero runtime dependencies except Google Fonts +
lucide icons (charts are hand-rolled SVG).

## Architecture

```
core/     bus · store(localStorage+IndexedDB) · rng(provably-fair) · wallet(+cashier)
          registry · analytics · strategy · router · format
games/    game-base (shared bet lifecycle) +
          <name>/ { index.js (registers def) · logic.js (pure resolve) ·
                    ui.js (interactive board) · style.css }
          dice · limbo · mines · roulette · plinko · crash · keno · wheel
ui/       shell · lobby · game-view · analytics-view · strategy-view · cashier
          fairness-modal · settings-view · components · charts · bet-panel · modal
          casino-kit (chip tray + action bar) · autobet-modal · style-loader
app.js    bootstrap: init engine → register games → mount shell → route
```

Each game is a **self-contained folder** so it can carry its own logic, UI, strategy
and stylesheet independently. `game-base.js` holds the shared bet lifecycle; the felt
table, chip tray, action bar (Rebet / 2× / Undo / Clear / Turbo) and the auto-spin
modal (strategy presets + progression cap + safety stops + saved strategies) are shared
across table games.

### Key ideas

- **Game registry = extension point.** Each game self-registers `{ id, name, icon, houseEdge,
  logic, create }`. The lobby, router, analytics and strategy lab are all data-driven from it, so
  **adding a game = one new `games/*.js` + a one-line `import` in `app.js`.**
- **Logic split from UI.** Every game exposes a pure `logic.resolve(floats, params)`. The same
  function powers manual play, headless auto-bet, and instant Monte-Carlo backtests.
- **Provably fair.** `HMAC_SHA256(serverSeed, "clientSeed:nonce:cursor")` → floats. The server
  seed's hash is committed before play; rotating reveals it so any past bet can be recomputed in
  the Fairness modal.
- **Cashier.** One fake USD bankroll with a configurable starting balance, deposit/withdraw, and a
  ledger — so ROI can be measured against net deposited, not just turnover.
- **Analytics.** Global + per-game, session/today/all-time, margin & ROI KPIs, equity curves,
  rolling "last X rounds" P/L, "last Y" recent form, cross-game comparison, and multiplier
  distribution — all recomputed on the fly from the IndexedDB history.
- **Strategy Lab.** Flat / Martingale / Paroli / D'Alembert / Fibonacci / custom progressions with
  stop conditions. Backtest thousands of rounds instantly (with a Monte-Carlo mode over many seeds),
  or run live against the bankroll.

## Games

| Game | Fairness | House edge |
|------|----------|-----------|
| Dice | roll = float×100; over/under | 1% (in payout) |
| Limbo | crash = (1−edge)/(1−u) | 1% (in payout) |
| Mines | Fisher–Yates mine layout | 1% (in payout) |
| American Roulette | float → pocket (0,00,1–36) | 5.26% (structural) |
| Plinko | `rows` fair coin flips → slot; RTP-scaled table | 1% |
| Crash | crash = (1−edge)/(1−u); cash out live | 1% |
| Keno | 10 drawn from 40; hypergeometric paytable | 3% |
| Wheel | float → segment; RTP-scaled ring | 2% |

Generated-payout games (Plinko, Keno, Wheel) build their tables from the exact
probability distribution and scale them to the target RTP, so the edge is provable and
tunable rather than hard-coded.

## Adding a game

1. Create `games/yourgame/` with `logic.js` (`floatsNeeded`, `resolve`, optional
   `strategy`), `ui.js` (`create(env) → { node, onMount }`), an optional `style.css`,
   and `index.js` that builds the `def` and calls `registry.register(def)`.
2. Add `import './games/yourgame/index.js';` to `app.js`.

That's it — it appears in the lobby, gets analytics, and (if it declares
`logic.strategy`) shows up in the Strategy Lab automatically.

---

*Gambling with real money carries real risk. This simulator is for entertainment and education only.*
