// ============================================================
//  Strategy Lab — configure a game + a bet progression, then
//  either BACKTEST it (fast, headless, seeded, no wallet impact,
//  optional Monte-Carlo over many trials) or RUN it LIVE against
//  the real bankroll with a live P/L feed.
// ============================================================

import { registry } from '../core/registry.js';
import { runBet } from '../games/game-base.js';
import { AutoBet, PRESETS, backtest, buildParams } from '../core/strategy.js';
import { h, icon, clear, statCard, sparkline, refreshIcons } from './components.js';
import { lineChart } from './charts.js';
import { money, signedMoney, signedPct, pct, int } from '../core/format.js';
import { KV } from '../core/store.js';

export function renderStrategies(env) {
  const games = registry.all().filter((d) => d.logic.strategy);
  let def = games[0];
  let sp = { ...def.logic.strategy.defaults() };

  const gameSel = h('select.sk-select', {}, games.map((d) => h('option', { value: d.id }, d.name)));
  const gameControls = h('div.sk-strat-game-controls', {});
  gameSel.onchange = () => { def = registry.get(gameSel.value); sp = { ...def.logic.strategy.defaults() }; renderGameControls(); };

  function renderGameControls() {
    clear(gameControls);
    for (const c of def.logic.strategy.controls) gameControls.append(control(c));
  }

  // progression
  const presetSel = h('select.sk-select', {}, Object.entries(PRESETS).map(([k, v]) => h('option', { value: k }, v.label)));
  const presetDesc = h('div.sk-hint', {}, PRESETS.flat.desc);
  const baseBet = numField('Base bet ($)', 1);
  const numBets = numField('Number of bets', 200);
  const stopProfit = numField('Stop on profit ($)', 0);
  const stopLoss = numField('Stop on loss ($)', 0);
  const winMode = ruleSel('reset'), winVal = numField('by', 100, true);
  const lossMode = ruleSel('multiply'), lossVal = numField('by', 2, true);
  const customBox = h('div.sk-custom-rules', { style: { display: 'none' } }, [
    h('div.sk-rule-row', {}, [h('span.sk-rule-tag.win', {}, 'On win'), winMode, winVal.node]),
    h('div.sk-rule-row', {}, [h('span.sk-rule-tag.loss', {}, 'On loss'), lossMode, lossVal.node]),
  ]);
  presetSel.onchange = () => { presetDesc.textContent = PRESETS[presetSel.value].desc; customBox.style.display = presetSel.value === 'custom' ? 'flex' : 'none'; };

  // backtest params
  const rounds = numField('Rounds', 500);
  const startBal = numField('Start balance ($)', 1000);
  const trials = numField('Trials (Monte Carlo)', 1);
  const seedField = numField('Seed', 12345);
  const shuffleBtn = h('button.sk-chip-btn', { onclick: () => seedField.set(Math.floor(Math.random() * 1e9)) }, [icon('shuffle'), 'Randomize']);

  const results = h('div.sk-strat-results', {});

  function settings() {
    return {
      preset: presetSel.value, baseBet: baseBet.get(),
      custom: { onWin: { mode: winMode.value, value: winVal.get() }, onLoss: { mode: lossMode.value, value: lossVal.get() } },
      numBets: numBets.get(), stopProfit: stopProfit.get(), stopLoss: stopLoss.get(),
    };
  }

  // ----- backtest -----
  const backtestBtn = h('button.sk-action-btn', { onclick: runBacktest }, [icon('flask-conical'), ' Backtest']);
  function runBacktest() {
    const st = settings();
    const N = Math.max(1, Math.min(2000, trials.get()));
    const rnd = Math.max(1, Math.min(100000, rounds.get()));
    const start = startBal.get();
    if (N === 1) {
      const r = backtest(def, sp, st, { rounds: rnd, startBalance: start, seed: seedField.get() });
      showSingle(r);
    } else {
      const nets = []; let profitable = 0, busts = 0; let best = -Infinity, worst = Infinity;
      for (let i = 0; i < N; i++) {
        const r = backtest(def, sp, st, { rounds: rnd, startBalance: start, seed: seedField.get() + i * 7919 });
        nets.push(r.net);
        if (r.net > 0) profitable++;
        if (r.busts) busts++;
        best = Math.max(best, r.net); worst = Math.min(worst, r.net);
      }
      showMonteCarlo({ nets, profitable, busts, best, worst, N, start });
    }
  }

  function showSingle(r) {
    clear(results);
    results.append(
      h('div.sk-panel-head', {}, [icon('flask-conical'), h('h3', {}, `Backtest · ${def.name} · ${r.rounds} rounds`)]),
      h('div.sk-kpi-grid', {}, [
        statCard('End balance', money(r.endBalance), { tone: r.net >= 0 ? 'up' : 'down' }),
        statCard('Net', signedMoney(r.net), { tone: r.net >= 0 ? 'up' : 'down', sub: signedPct(r.roi) + ' ROI' }),
        statCard('Win rate', pct(r.winRate), { sub: `${int(r.wins)}/${int(r.wins + r.losses)}` }),
        statCard('Realized RTP', pct(r.rtp)),
        statCard('Max drawdown', money(r.maxDrawdown), { tone: 'down' }),
        statCard('Longest loss', int(r.maxLossStreak), { sub: r.busts ? 'BUST — ran out' : 'streak' }),
      ]),
      h('div.sk-panel-chart', {}, [lineChart(r.curve, { h: 240, color: r.net >= 0 ? 'var(--sk-up)' : 'var(--sk-down)' })]),
      r.busts ? h('div.sk-warn', {}, [icon('triangle-alert'), ' The bankroll was wiped out before finishing — the classic risk of aggressive progressions.']) : null,
    );
    refreshIcons();
  }

  function showMonteCarlo({ nets, profitable, busts, best, worst, N, start }) {
    const sorted = [...nets].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const mean = nets.reduce((s, v) => s + v, 0) / nets.length;
    clear(results);
    results.append(
      h('div.sk-panel-head', {}, [icon('dices'), h('h3', {}, `Monte Carlo · ${N} trials · ${def.name}`)]),
      h('div.sk-kpi-grid', {}, [
        statCard('Profitable', pct(profitable / N), { tone: profitable / N >= 0.5 ? 'up' : 'down', sub: `${profitable}/${N} runs` }),
        statCard('Median net', signedMoney(median), { tone: median >= 0 ? 'up' : 'down' }),
        statCard('Mean net', signedMoney(mean), { tone: mean >= 0 ? 'up' : 'down' }),
        statCard('Best', signedMoney(best), { tone: 'up' }),
        statCard('Worst', signedMoney(worst), { tone: 'down' }),
        statCard('Bust rate', pct(busts / N), { tone: 'down', sub: `${busts} wiped out` }),
      ]),
      h('div.sk-panel-head', {}, [h('h4', {}, 'Sorted outcomes (worst → best)')]),
      h('div.sk-panel-chart', {}, [lineChart(sorted, { h: 200, color: 'var(--sk-accent)' })]),
      h('div.sk-hint', {}, 'A rising tail on the right with a heavy negative left is the signature of martingale-style strategies: usually a small win, occasionally a catastrophic loss.'),
    );
    refreshIcons();
  }

  // ----- live run -----
  let auto = null;
  const liveOut = h('div.sk-strat-live', {});
  const liveBtn = h('button.sk-action-btn.auto', { onclick: toggleLive }, [icon('play'), ' Run Live']);
  function toggleLive() {
    if (auto && auto.running) { auto.stop(); return; }
    const base = baseBet.get();
    const err = env.wallet.validateBet(base);
    if (err) return env.bus.emit('toast', { message: err, tone: 'warn' });
    let cum = 0; const curve = [0];
    clear(liveOut);
    const bets = h('span.v', {}, '0'), profit = h('span.v', {}, '$0.00'), spark = h('div', {});
    liveOut.append(h('div.sk-live-row', {}, [kv('Bets', bets), kv('Profit', profit)]), spark);
    auto = new AutoBet({
      betFn: async (wager) => {
        const e = env.wallet.validateBet(wager); if (e) return { error: e };
        const params = buildParams(def, sp, wager);
        const { record } = await runBet(env, def, wager, params);
        return { won: record.won, profit: record.profit, multiplier: record.multiplier, record };
      },
      settings: { ...settings(), delayMs: 60 },
      onTick: (t) => {
        cum = t.profit; curve.push(cum);
        bets.textContent = String(t.count);
        profit.textContent = signedMoney(cum); profit.className = 'v tone-' + (cum >= 0 ? 'up' : 'down');
        clear(spark); spark.append(sparkline(curve.slice(-120), { w: 320, h: 60, stroke: cum >= 0 ? 'var(--sk-up)' : 'var(--sk-down)' }));
      },
      onStateChange: (s) => {
        liveBtn.innerHTML = ''; liveBtn.append(icon(s.running ? 'square' : 'play'), document.createTextNode(s.running ? ' Stop' : ' Run Live'));
        liveBtn.classList.toggle('running', !!s.running);
        if (!s.running && s.reason && s.reason !== 'stopped') env.bus.emit('toast', { message: `Stopped — ${s.reason}`, tone: 'info' });
        refreshIcons();
      },
    });
    auto.start();
  }

  // ----- save / load -----
  const savedWrap = h('div.sk-saved-strats', {});
  function renderSaved() {
    const saved = KV.get('strategies', []);
    clear(savedWrap);
    if (!saved.length) { savedWrap.append(h('span.sk-hint', {}, 'No saved strategies yet.')); return; }
    for (const s of saved) {
      savedWrap.append(h('button.sk-chip-btn', { onclick: () => loadStrat(s) }, [s.name,
        h('span.sk-chip-x', { onclick: (e) => { e.stopPropagation(); deleteStrat(s.name); } }, '×')]));
    }
  }
  function saveStrat() {
    const name = prompt('Name this strategy:');
    if (!name) return;
    const saved = KV.get('strategies', []).filter((x) => x.name !== name);
    saved.push({ name, gameId: def.id, sp: { ...sp }, settings: settings() });
    KV.set('strategies', saved); renderSaved();
    env.bus.emit('toast', { message: 'Strategy saved', tone: 'success' });
  }
  function deleteStrat(name) { KV.set('strategies', KV.get('strategies', []).filter((x) => x.name !== name)); renderSaved(); }
  function loadStrat(s) {
    gameSel.value = s.gameId; def = registry.get(s.gameId); sp = { ...s.sp }; renderGameControls();
    presetSel.value = s.settings.preset; presetSel.onchange();
    baseBet.set(s.settings.baseBet); numBets.set(s.settings.numBets); stopProfit.set(s.settings.stopProfit); stopLoss.set(s.settings.stopLoss);
    env.bus.emit('toast', { message: `Loaded “${s.name}”`, tone: 'info' });
  }

  renderGameControls();
  renderSaved();

  const config = h('div.sk-strat-config', {}, [
    section('Game', [field('Game', gameSel), gameControls]),
    section('Progression', [
      field('Strategy', presetSel), presetDesc, customBox,
      h('div.sk-field-grid', {}, [baseBet.node, numBets.node]),
      h('div.sk-field-grid', {}, [stopProfit.node, stopLoss.node]),
    ]),
    section('Backtest', [
      h('div.sk-field-grid', {}, [rounds.node, startBal.node]),
      h('div.sk-field-grid', {}, [trials.node, seedField.node]),
      shuffleBtn,
      h('div.sk-field-grid', {}, [backtestBtn, liveBtn]),
      liveOut,
    ]),
    section('Saved', [savedWrap, h('button.sk-chip-btn', { onclick: saveStrat }, [icon('save'), 'Save current'])]),
  ]);

  return h('div.sk-view.sk-strategies', {}, [
    h('div.sk-view-head', {}, [h('h1', {}, 'Strategy Lab'),
      h('p', {}, 'Model betting systems before you risk (fake) money. Backtest thousands of rounds instantly, or run live.')]),
    h('div.sk-strat-layout', {}, [config, h('div.sk-strat-main', {}, [results])]),
  ]);

  // ---- helpers ----
  function control(c) {
    if (c.type === 'select') {
      const s = h('select.sk-select', {}, c.options.map((o) => h('option', { value: o.value }, o.label)));
      s.value = sp[c.key]; s.onchange = () => { sp[c.key] = s.value; };
      return field(c.label, s);
    }
    const inp = h('input.sk-num', { type: 'number', value: sp[c.key], step: c.step || 1, min: c.min, max: c.max });
    inp.oninput = () => { sp[c.key] = c.type === 'number' ? Number(inp.value) : inp.value; };
    return field(c.label, inp);
  }
  function numField(label, val, compact) {
    const inp = h('input.sk-num', { type: 'number', step: 'any', value: val });
    return { node: h('div.sk-field' + (compact ? '.compact' : ''), {}, [h('label.sk-label', {}, label), inp]), get: () => Number(inp.value) || 0, set: (v) => { inp.value = v; } };
  }
  function ruleSel(dv) {
    const s = h('select.sk-select.sm', {}, [['reset', 'reset to base'], ['multiply', 'multiply ×'], ['increase', 'increase %'], ['decrease', 'decrease %']].map(([v, l]) => h('option', { value: v }, l)));
    s.value = dv; return s;
  }
  function field(label, node) { return h('div.sk-field', {}, [h('label.sk-label', {}, label), node]); }
  function section(title, children) { return h('div.sk-strat-section', {}, [h('h3', {}, title), ...children]); }
  function kv(label, valEl) { return h('div.sk-kv', {}, [h('span.k', {}, label), valEl]); }
}
