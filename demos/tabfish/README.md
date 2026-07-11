# 🎣 Tabfish

**The fishing game you play by *not* playing it.**

Cast your lure, then switch tabs and do your actual work. The lure sinks in **real
time** — even while this tab is in the background or closed. The longer you ignore it,
the deeper it goes and the rarer the fish that bite. When one does, your browser tab
title flips to **❗ FISH ON ❗** and its icon turns red. Come back, set the hook, and
land it before it escapes.

Live: **https://viper-vm.github.io/demos/tabfish/**

## Why it's novel

It's an idle game that inverts the genre's core compulsion: instead of rewarding
constant clicking, it rewards **leaving**. The pitch — *"a fishing game you play by
not playing it"* — is a one-liner made for Hacker News / X, and every trophy catch
generates a share card (*"🐡 Anglerfish · 67kg · hooked at 2600m"*).

## How it works (no server, no build)

- **Single static file** — vanilla HTML/CSS/JS. Ships on GitHub Pages.
- **Real-time depth** — depth is `130 × √(minutes)`, computed purely from timestamps, so it accrues while the tab is backgrounded or fully closed. Reopen after a night and you're in the abyss.
- **Fast-forward on load** — on return, the game replays any pending bite from timestamps: catch it if you got back inside the 60-second window, or read "the one that got away" if you didn't.
- **Tab-bar as the game surface** — `document.title` becomes a live depth ticker, and the favicon swaps to a red alert on a bite (both update even in a background tab, which is the whole gimmick).
- **Depth-weighted catches** — five zones (Sunlit → Twilight → Midnight → Abyss → Hadal), each with its own species and weight range. Deeper water biases toward rarer, heavier fish, with an occasional jackpot from one zone below.
- **Skill on the hook-set** — a sweeping timing bar; the green strike zone shrinks for deeper, rarer fish. A perfect (centered) strike adds a weight bonus.
- **Safe `localStorage`** wrapper (in-memory fallback for in-app webviews) stores your bucket and stats.

## The depths

| Zone | Depth | Sample catches |
|---|---|---|
| Sunlit | 0–300m | anchovy, sardine, pufferfish |
| Twilight | 300–900m | mackerel, reef squid, octopus |
| Midnight | 900–2000m | lanternfish, viperfish, ribbon eel |
| The Abyss | 2000–3800m | anglerfish, gulper eel, frilled shark |
| Hadal Deep | 3800m+ | dragonfish, colossal squid, coelacanth, **The Nameless** |

## Debug hooks (in the console)

- `__tabfish.state()` — phase, current depth, biting fish, catch count
- `__tabfish.cast()` / `__tabfish.bump(minutes)` — cast and fast-forward sink time
- `__tabfish.forceBite()` — trigger a bite at the current depth
- `__tabfish.reset()` — wipe the bucket

Built by Vivek Modi.
