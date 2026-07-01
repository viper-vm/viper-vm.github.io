// ============================================================
//  Fairness modal — inspect the active seeds, rotate (revealing
//  the old server seed), and independently verify any result by
//  recomputing its HMAC-SHA256 float stream.
// ============================================================

import { openModal } from './modal.js';
import { h, icon, clear, refreshIcons } from './components.js';
import { verifyFloats, sha256Hex } from '../core/rng.js';

export function openFairness(env) {
  const fair = env.fair;

  const activeBox = h('div.sk-fair-active', {});
  const prevBox = h('div.sk-fair-prev', {});
  const clientInput = h('input.sk-mono-input', { value: fair.clientSeed });

  // verifier fields
  const vServer = h('input.sk-mono-input', { placeholder: 'revealed server seed' });
  const vClient = h('input.sk-mono-input', { value: fair.clientSeed });
  const vNonce = h('input.sk-num', { type: 'number', value: 0, min: 0 });
  const vCount = h('input.sk-num', { type: 'number', value: 8, min: 1, max: 32 });
  const vOut = h('div.sk-fair-verify-out', {});

  const body = h('div.sk-fair', {}, [
    h('p.sk-fair-intro', {}, 'Each result is HMAC_SHA256(serverSeed, clientSeed:nonce:cursor) → floats. The server seed’s hash is committed before you play; rotating reveals the seed so you can recompute every past bet.'),

    h('section.sk-fair-section', {}, [
      h('h3', {}, 'Active seeds'),
      activeBox,
      h('div.sk-fair-client', {}, [
        h('label.sk-label', {}, 'Client seed (editable)'),
        h('div.sk-inline', {}, [clientInput,
          h('button.sk-chip-btn', { onclick: () => { fair.setClientSeed(clientInput.value); env.bus.emit('toast', { message: 'Client seed updated', tone: 'success' }); paint(); } }, 'Save')]),
      ]),
      h('button.sk-action-btn.rotate', { onclick: rotate }, [icon('rotate-cw'), ' Rotate server seed (reveal current)']),
    ]),

    prevBox,

    h('section.sk-fair-section', {}, [
      h('h3', {}, 'Verify a result'),
      h('div.sk-fair-grid', {}, [
        field('Server seed', vServer),
        field('Client seed', vClient),
        field('Nonce', vNonce),
        field('Floats', vCount),
      ]),
      h('button.sk-chip-btn', { onclick: runVerify }, [icon('shield-check'), ' Compute floats']),
      vOut,
    ]),
  ]);

  openModal({ title: 'Provably Fair', icon: 'shield-check', body, width: '620px' });
  paint();

  function paint() {
    const s = fair.publicState();
    clear(activeBox);
    activeBox.append(
      kv('Server seed hash (commitment)', s.serverSeedHash),
      kv('Client seed', s.clientSeed),
      kv('Nonce (next bet)', String(s.nonce)),
    );
    clear(prevBox);
    if (s.previous) {
      prevBox.className = 'sk-fair-prev sk-fair-section';
      prevBox.append(
        h('h3', {}, ['Previous seed ', h('span.sk-badge.provably', {}, [icon('unlock'), 'revealed'])]),
        kv('Server seed', s.previous.serverSeed),
        kv('Server seed hash', s.previous.serverSeedHash),
        kv('Client seed', s.previous.clientSeed),
        kv('Bets made under it', String(s.previous.nonce)),
        h('button.sk-chip-btn', { onclick: async () => {
          const hash = await sha256Hex(s.previous.serverSeed);
          const ok = hash === s.previous.serverSeedHash;
          env.bus.emit('toast', { message: ok ? 'Hash matches — seed authentic ✓' : 'Hash mismatch!', tone: ok ? 'success' : 'danger' });
        } }, 'Check hash matches commitment'),
      );
      // prime the verifier with the revealed seed
      if (!vServer.value) { vServer.value = s.previous.serverSeed; vClient.value = s.previous.clientSeed; }
    }
    refreshIcons();
  }

  async function rotate() {
    await fair.rotate();
    env.bus.emit('toast', { message: 'Server seed rotated — previous seed revealed', tone: 'info' });
    paint();
  }

  async function runVerify() {
    const server = vServer.value.trim();
    const client = vClient.value.trim();
    const nonce = Number(vNonce.value) || 0;
    const count = Math.max(1, Math.min(32, Number(vCount.value) || 8));
    if (!server) { env.bus.emit('toast', { message: 'Enter a server seed', tone: 'warn' }); return; }
    const floats = await verifyFloats(server, client, nonce, count);
    const hash = await sha256Hex(server);
    clear(vOut);
    vOut.append(
      h('div.sk-fair-hash', {}, [h('span', {}, 'SHA-256(server seed): '), h('code', {}, hash)]),
      h('div.sk-fair-floats', {}, floats.map((f, i) =>
        h('div.sk-fair-float', {}, [h('span', {}, '#' + i), h('code', {}, f.toFixed(8))]))),
    );
  }

  function kv(label, value) {
    return h('div.sk-fair-kv', {}, [h('span.k', {}, label), h('code.v', {}, value || '—')]);
  }
  function field(label, input) { return h('div.sk-field', {}, [h('label.sk-label', {}, label), input]); }
}
