// ============================================================
//  Game base — shared bet lifecycle so every game persists,
//  pays out and reports identically.
//
//  Two entry points:
//   • runBet(env, def, wager, params)  — one-shot games
//     (Dice, Limbo, Roulette): validate → debit → draw fair
//     floats → def.logic.resolve() → credit → record → emit.
//   • placeWager / drawFloats / settle — building blocks for
//     stateful games (Mines) that reveal over several clicks
//     and settle later.
//
//  `env` = { wallet, fair, store, bus }.
// ============================================================

export function placeWager(env, wager) {
  const error = env.wallet.validateBet(wager);
  if (error) return { ok: false, error };
  env.wallet.debit(wager);
  return { ok: true };
}

export async function drawFloats(env, count) {
  return env.fair.draw(count); // { floats, ctx }
}

// Credit payout, build + persist the canonical bet record, emit.
export async function settle(env, {
  game, wager, multiplier, payout, won, detail, meta, fairCtx,
}) {
  env.wallet.credit(payout);
  const profit = payout - wager;
  const record = {
    ts: Date.now(),
    game,
    wager,
    multiplier: multiplier ?? (wager > 0 ? payout / wager : 0),
    payout,
    profit,
    won: won != null ? won : profit > 1e-9,
    detail: detail || '',
    meta: meta || {},
    fair: fairCtx
      ? { serverSeedHash: fairCtx.serverSeedHash, clientSeed: fairCtx.clientSeed, nonce: fairCtx.nonce, serverSeed: null }
      : null,
    balanceAfter: env.wallet.balance,
  };
  try {
    record.id = await env.store.addBet(record);
  } catch (err) {
    console.warn('[game] failed to persist bet', err);
  }
  env.bus.emit('bet:settled', record);
  return record;
}

// One-shot bet for stateless games.
export async function runBet(env, def, wager, params) {
  const placed = placeWager(env, wager);
  if (!placed.ok) return { error: placed.error };

  const count = def.logic.floatsNeeded(params);
  const { floats, ctx } = await drawFloats(env, count);
  const r = def.logic.resolve(floats, params);
  const payout = r.payout != null ? r.payout : (r.won ? wager * r.multiplier : 0);

  const record = await settle(env, {
    game: def.id,
    wager,
    multiplier: r.multiplier,
    payout,
    won: r.won,
    detail: r.detail,
    meta: r.meta,
    fairCtx: ctx,
  });

  return { record, result: r, floats, ctx };
}
