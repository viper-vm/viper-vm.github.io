# 👻 Ghostpile

**A dodge-run chain letter. Every winner becomes a wall.**

Hold anywhere (or press space) to rise, release to fall, and thread a seeded cave.
Beat it, and your exact flight path is frozen into the URL as a solid, named ribbon —
so the link you send is strictly harder than the one you got. A pile grows one ghost
at a time as it hops between phones, until it becomes a near-impossible tangle.

Live: **https://viper-vm.github.io/demos/ghostpile/**

## Why it spreads

Forwarding is the win condition — you can't brag without minting a harder level.
Every share is a playable artifact, and there's no backend: the entire pile of ghosts
is delta-encoded into the URL hash.

## How it works (no server, no build)

- **Single static file** — `index.html`, vanilla HTML/CSS/JS on a `<canvas>`. Ships on GitHub Pages.
- **Deterministic cave** — generated from a 32-bit seed in the hash, so everyone with the same link plays the identical cave.
- **Path codec** — a winning flight is simplified (Ramer–Douglas–Peucker), quantized, delta + varint encoded, base64url-packed, and appended to the hash. ~150–300 bytes per ghost; a full 16-ghost pile stays a few KB. A trailing XOR checksum detects links truncated by messenger apps and falls back to a fresh cave.
- **Collision** — ribbons are spatially bucketed; touching any ribbon or the cave wall ends the run. A wide grace funnel at the start keeps the first ~430px fair no matter how crowded the pile gets.
- **Share** — copy text + challenge link, `navigator.share`, and a canvas-rendered PNG score card. Safe `localStorage` wrapper with in-memory fallback so it works in Instagram/WhatsApp in-app webviews and cookie-blocked browsers.

## Controls

| | Touch | Desktop |
|---|---|---|
| Fly | Hold anywhere | Hold Space / ↑ |
| Retry | Tap after death | Press Space |

## Debug hooks (in the console)

- `__gpSim(maxFrames)` — headless autopilot run, returns final state + minted URL
- `__gpSelfTest()` — round-trips the path codec and checks truncation detection
- `__gpState()` — current game state snapshot
- `__gpCard()` — returns a PNG data URL of the current pile's score card

Built by Vivek Modi.
