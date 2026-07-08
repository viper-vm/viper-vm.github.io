# WordGen — Rewrite anything.

WordGen turns any text into the version you actually want: paraphrase it, fix the
grammar, change the tone, expand or shorten it, reshape it into a better LLM prompt,
restyle it as an email or a WhatsApp message, or swap a single word for a
context-aware synonym.

It comes in two surfaces that share one core:

- **Web app** — a single-page workspace at [`/demos/wordgen/`](https://viper-vm.github.io/demos/wordgen/).
- **Chrome extension** — a sticky-note panel that pops out on any page. See
  [`extension/README.md`](extension/README.md).

Both work **for free, offline**, with a built-in local engine. Add your own API key
(Claude, any OpenAI-compatible endpoint, or a custom one) to unlock the AI-powered
modes — the key lives only in your browser and is sent only to the provider you pick.

## Modes

| Category | Modes |
| --- | --- |
| **Rewrite** | Paraphrase · Fix grammar · Make shorter · Expand · Simplify · More formal · More casual |
| **Prompt** | Better prompt · Tech-savvy prompt · Simple prompt |
| **Message** | Polished email · LinkedIn message · WhatsApp message · Instagram caption · To a friend · To a superior · X / Tweet |
| **Words** | Synonyms (context-aware, single word) |

You can also type a free-form instruction ("mention the deadline is Friday", "make it
sound excited") with or without picking a mode.

## Using it

1. Paste or type text in the editor (or **Load sample**).
2. Pick a mode chip, or type an instruction, or both.
3. Hit **Transform ✦** (or ⌘/Ctrl + Enter). You get a few options, each with a note on
   the angle it took, plus **Copy**, **Replace**, and a word-level **diff** toggle.
4. **Select a phrase** inside the editor to get a floating toolbar — transform just that
   selection, or select a single word for instant synonyms.
5. Everything you run is saved to **History** (last 100, stored locally).

## Bring your own key (optional)

Open **Settings** and choose an engine:

- **Local** — free, offline, no key. Best at synonyms and quick rule-based rewrites.
- **Claude (Anthropic)** — best quality across every mode. Get a key at
  [console.anthropic.com](https://console.anthropic.com). WordGen calls the Messages API
  directly from your browser using the `anthropic-dangerous-direct-browser-access` header.
  Models: Claude Opus 4.8 (best), Sonnet 5 (balanced), Haiku 4.5 (fastest).
- **OpenAI-compatible** — set a model and endpoint. Works with OpenAI, Groq, Ollama,
  Google's OpenAI-compatible endpoint, and similar. Uses JSON mode where supported.
- **Custom endpoint** — POST JSON to your own URL. WordGen sends
  `{action, mode, text, word, context, opts}` and expects `{options:[{text,note}]}`
  (transforms) or `{candidates:[{word,register,note}]}` (synonyms) back.

Use **Test connection** to confirm a provider works before saving.

## Architecture

```
demos/wordgen/
├── index.html              # web app shell
├── css/styles.css          # three themes: Paper, Ink, Mist
├── js/
│   ├── main.js             # orchestration (modes, transform, history, settings, popover)
│   └── ui.js               # DOM helpers, toasts, word diff, caret geometry
├── core/                   # shared single source of truth (web + extension)
│   ├── modes.js            # the mode registry + prompt builders
│   ├── providers.js        # local / anthropic / openai / custom adapters
│   ├── local-engine.js     # offline synonyms + rule-based rewrites
│   └── history.js          # storage-agnostic history store
├── assets/                 # lexicon, embeddings, n-gram, demo texts (JSON)
├── extension/              # MV3 Chrome extension (see extension/README.md)
└── server/                 # optional FastAPI stub — not used by the static site
```

The `core/` modules are the contract between the two surfaces. The extension keeps its own
copy under `extension/core/`; run [`extension/sync-core.sh`](extension/sync-core.sh) after
changing anything in `core/` or `assets/` to re-sync it.

No build step, no npm, no runtime dependencies. Just static files.

## Privacy

- The local engine never touches the network.
- API keys are stored only in your browser (`localStorage` for the web app,
  `chrome.storage` for the extension) and are sent only to the provider you configure.
- No analytics, no WordGen server in between.

## Themes

Three distinct looks, switchable live from the header dots and remembered per browser:
**Paper** (warm, editorial, sticky-note yellow), **Ink** (flat dark, mint accent), and
**Mist** (cool, airy, indigo).

---

Built by [Vivek Modi](https://github.com/viper-vm). Part of the
[viper-vm.github.io](https://viper-vm.github.io) demo collection.
