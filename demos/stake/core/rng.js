// ============================================================
//  Provably-Fair RNG
//  Mirrors Stake's scheme so any result can be independently
//  verified:
//     HMAC_SHA256(serverSeed, `${clientSeed}:${nonce}:${cursor}`)
//  → 32 bytes → consumed in 4-byte groups, each mapped to a
//  float in [0, 1). A game asks for as many floats as it needs;
//  cursor advances across HMAC blocks for games that need many.
//
//  Fairness lifecycle:
//    • serverSeed is generated locally and kept hidden while in use.
//    • Its SHA-256 hash (the "commitment") is shown up-front.
//    • nonce increments per bet.
//    • Rotating the seed REVEALS the old serverSeed so every past
//      bet under it can be recomputed → proving nothing was altered.
// ============================================================

import { KV } from './store.js';

const enc = new TextEncoder();

function toHex(buf) {
  const b = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
  return s;
}

function randomHex(bytes = 32) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return toHex(arr);
}

export async function sha256Hex(message) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(message));
  return toHex(digest);
}

async function hmacSha256(keyStr, msgStr) {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(keyStr),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msgStr));
  return new Uint8Array(sig); // 32 bytes
}

// Convert a 32-byte HMAC block into 8 floats in [0,1) using the
// standard 4-bytes-per-float big-endian construction Stake uses.
function bytesToFloats(bytes) {
  const floats = [];
  for (let i = 0; i < bytes.length; i += 4) {
    let f = 0;
    for (let j = 0; j < 4; j++) {
      f += bytes[i + j] / Math.pow(256, j + 1);
    }
    floats.push(f);
  }
  return floats; // 8 floats
}

// Produce `count` fair floats for (serverSeed, clientSeed, nonce),
// walking the cursor across HMAC blocks as needed.
export async function fairFloats(serverSeed, clientSeed, nonce, count) {
  const out = [];
  let cursor = 0;
  while (out.length < count) {
    const bytes = await hmacSha256(serverSeed, `${clientSeed}:${nonce}:${cursor}`);
    out.push(...bytesToFloats(bytes));
    cursor += 1;
  }
  return out.slice(0, count);
}

export class ProvablyFair {
  constructor(bus) {
    this.bus = bus;
    const saved = KV.get('fair', null);
    if (saved) {
      this.serverSeed = saved.serverSeed;
      this.serverSeedHash = saved.serverSeedHash;
      this.clientSeed = saved.clientSeed;
      this.nonce = saved.nonce | 0;
      this.previous = saved.previous || null; // {serverSeed, serverSeedHash, clientSeed, nonce}
    } else {
      this.serverSeed = randomHex();
      this.serverSeedHash = null; // computed in init()
      this.clientSeed = randomHex(8);
      this.nonce = 0;
      this.previous = null;
    }
  }

  async init() {
    if (!this.serverSeedHash) {
      this.serverSeedHash = await sha256Hex(this.serverSeed);
      this._persist();
    }
    return this;
  }

  _persist() {
    KV.set('fair', {
      serverSeed: this.serverSeed,
      serverSeedHash: this.serverSeedHash,
      clientSeed: this.clientSeed,
      nonce: this.nonce,
      previous: this.previous,
    });
  }

  // Reserve the current nonce for a bet and advance. Returns the
  // seed context so the bet record can store what produced it.
  nextContext() {
    const ctx = {
      serverSeed: this.serverSeed,
      serverSeedHash: this.serverSeedHash,
      clientSeed: this.clientSeed,
      nonce: this.nonce,
    };
    this.nonce += 1;
    this._persist();
    return ctx;
  }

  // Draw floats for the current bet (advances nonce once).
  async draw(count) {
    const ctx = this.nextContext();
    const floats = await fairFloats(ctx.serverSeed, ctx.clientSeed, ctx.nonce, count);
    return { floats, ctx };
  }

  setClientSeed(seed) {
    this.clientSeed = (seed || '').trim() || randomHex(8);
    this._persist();
    this.bus?.emit('seed:rotated', this.publicState());
  }

  // Rotate: reveal current server seed, commit to a fresh one.
  async rotate() {
    this.previous = {
      serverSeed: this.serverSeed,
      serverSeedHash: this.serverSeedHash,
      clientSeed: this.clientSeed,
      nonce: this.nonce,
    };
    this.serverSeed = randomHex();
    this.serverSeedHash = await sha256Hex(this.serverSeed);
    this.nonce = 0;
    this._persist();
    this.bus?.emit('seed:rotated', this.publicState());
    return this.previous;
  }

  publicState() {
    return {
      serverSeedHash: this.serverSeedHash,
      clientSeed: this.clientSeed,
      nonce: this.nonce,
      previous: this.previous,
    };
  }
}

// Stand-alone verification used by the fairness modal: recompute
// the exact float stream from revealed seeds.
export async function verifyFloats(serverSeed, clientSeed, nonce, count) {
  return fairFloats(serverSeed, clientSeed, nonce, count);
}
