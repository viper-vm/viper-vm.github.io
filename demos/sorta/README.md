# 🔷 Sorta

**Crack the machine's secret rule.**

A daily deduction game. A machine has one hidden rule about shapes — something like
*"accepts anything cool-colored"*, *"striped OR triangles"*, or *"NOT patterned"*.
You build probe shapes from four dials (form, color, fill, size), feed them in, and
watch what it accepts or rejects. Crack the rule, then predict its verdict on the
**5-shape exam that everyone on Earth takes today**. Share your score as a spoiler-free
emoji grid.

Live: **https://viper-vm.github.io/demos/sorta/**

## Why it spreads

Everyone faces the identical rule and the identical 5-shape exam each day, so results
are directly comparable — *"you got 2/5?? it was obviously the colors"* is exactly the
argument-fuel that makes Wordle-style dailies spread. Share format:

```
Sorta #11
5/5  🟩🟩🟩🟩🟩
🔬 cracked with 3 probes
```

## How it works (no server, no build)

- **Single static file** — vanilla HTML/CSS/JS, shapes drawn on `<canvas>`. Ships on GitHub Pages.
- **Deterministic daily puzzle** — the rule and exam are generated from the UTC date, so the whole planet gets the same puzzle. A validator re-rolls any rule that accepts <15% or >80% of the 360 possible shapes, guaranteeing every day is crackable and fair, with a balanced exam (2–3 accepts).
- **Rule engine** — rules are ATOM / NOT / AND / OR over predicates spanning single values (`blue`, `triangles`, `striped`, `big`) and broad categories (`warm-colored`, `patterned`, `many-sided`, `round`). Compound rules combine predicates from different attributes so they stay learnable.
- **Persistence** — a safe `localStorage` wrapper (in-memory fallback for in-app webviews) stores your progress and result so you can't retake today's puzzle, plus a daily streak counter.
- **Practice mode** — a random puzzle any time, so you can learn (or keep playing) without "spending" the daily.

## Attributes

| Dial | Options |
|---|---|
| Form | triangle, square, circle, pentagon, star |
| Color | red, orange, yellow, green, blue, purple |
| Fill | solid, striped, dotted, hollow |
| Size | small, medium, large |

360 possible shapes.

## Debug hooks (in the console)

- `__sorta.state` — current phase, probe count, guesses, rule text, accept ratio
- `__sorta.rule()` / `__sorta.exam()` — reveal today's rule and exam verdicts
- `__sorta.selfTest()` — validates fairness + determinism across 120 days of puzzles

Built by Vivek Modi.
