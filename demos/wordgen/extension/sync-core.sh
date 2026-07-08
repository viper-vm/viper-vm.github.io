#!/usr/bin/env bash
# Copy the shared core modules and data assets from the web app into the
# extension so the extension has a self-contained copy. Run this after any
# change to ../core/*.js or ../assets/*.json.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
src="$here/.."

mkdir -p "$here/core" "$here/assets"

cp "$src"/core/*.js "$here/core/"

# The extension's local engine needs the lexicon, embeddings, and n-gram data.
# demo-texts.json is web-app only (the extension prefills from the page selection).
for f in lexicon.json mini-embeddings.json ngram-freq.json; do
  cp "$src/assets/$f" "$here/assets/$f"
done

echo "Synced core/*.js and assets into extension/."
