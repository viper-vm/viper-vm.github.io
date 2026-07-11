# ◎ Askew

**Tap the exact center. Discover which way your brain secretly leans.**

A shape flashes up — a box, a ring of dots, a triangle, a blob. Tap where you think its
exact center is. One tap, no do-overs. Twenty shapes take about 45 seconds. Then Askew
separates two things about your aim: how *precise* you are, and the direction you
*consistently* drift — the hidden bias your brain has even when you swear you nailed it.

Live: **https://viper-vm.github.io/demos/askew/**

## Why it spreads

The output is a **dichotomous identity plus a number** — *"Left-leaner, up-left, bias
3.2%, precision 88/100"* — the same self-categorization pattern that makes
political-compass and personality content spread. Built-in discourse: lefties vs
righties, high-aimers vs low-aimers, surgeons vs the shaky. The scatter-plot result is
screenshot-bait — you can literally *see* your cluster sitting off-center.

## How it works (no server, no build)

- **Single static file** — vanilla HTML/CSS/JS on a `<canvas>`. Ships on GitHub Pages.
- **Six shape types** — rectangle, ellipse, ring-of-dots, triangle, cross, and irregular blob. Each has a mathematically exact center (the blob uses the true polygon centroid), so there's always a correct answer.
- **Randomized position, size, and rotation** every round, so you can't memorize a spot — only a genuine directional bias survives 20 rounds.
- **The two metrics**:
  - **Precision** = tightness of your error cluster (its standard deviation), normalized by each shape's size so big and small shapes count equally.
  - **Bias** = the *mean* error vector — the systematic offset that remains after the noise averages out. Expressed as a % of shape size and a compass direction.
- **Scatter visualization** — all 20 normalized errors plotted on a crosshair, with the dead-center X and your average-aim arrow, rendered to a canvas for sharing.
- **Safe `localStorage`** wrapper stores your best precision.

## The score

You get an **identity** (Left-leaner, up-right drifter, dead-center…), a **bias %**, and
a **precision score** out of 100 with a grade from *Surgeon* to *Shaky*.

## Debug hooks (in the console)

- `__askew.state()` — current phase and round
- `__askew.auto(biasX, biasY, noise)` — simulate a full run with a chosen bias (fractions of shape size) and see the computed result

Built by Vivek Modi.
