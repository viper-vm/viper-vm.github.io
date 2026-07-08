# WordGen Chrome extension

A sticky note for your browser. Click the toolbar icon and a small paper note slides onto the
page: paste or select any text, pick a mode — paraphrase, fix grammar, make it shorter, recast it
as an email, a tweet, a LinkedIn message, a better LLM prompt — and get back two or three options
you can copy or insert straight into the field you were typing in. Select a single word anywhere
and WordGen offers context-aware synonyms in one click.

It works out of the box with a free, fully offline local engine. Bring your own API key
(Anthropic, OpenAI, or any OpenAI-compatible endpoint) to unlock every mode at full quality.

The extension shares its core logic with the [WordGen web app](https://viper-vm.github.io/demos/wordgen/).

## Install (load unpacked)

The extension is not on the Chrome Web Store yet, so you load it as an unpacked developer
extension. It takes about a minute:

1. Download or clone this repository, and note the full path of the `demos/wordgen/extension`
   folder (this folder — the one containing `manifest.json`).
2. If you are working from a fresh checkout, run the sync script once so the shared core and data
   files are in place: `sh demos/wordgen/extension/sync-core.sh`. If the `core/` and `assets/`
   folders already exist next to this README, skip this step.
3. Open Chrome and go to `chrome://extensions`.
4. Turn on **Developer mode** using the toggle in the top-right corner of the page.
5. Click the **Load unpacked** button that appears in the top-left, and select the
   `demos/wordgen/extension` folder.
6. WordGen appears in the extension list. Click the puzzle-piece icon in Chrome's toolbar and pin
   WordGen so its icon is always visible.

To update later, pull the latest code and press the circular refresh arrow on WordGen's card in
`chrome://extensions`.

The same steps work in Edge, Brave, and other Chromium browsers (the extensions page URL may
differ, e.g. `edge://extensions`).

## Using it

- **Toggle the note**: click the WordGen toolbar icon, or press **Ctrl+Shift+Space**
  (**Cmd+Shift+Space** on a Mac). The note opens in the top-right of the page; drag it by its
  header, resize it from the bottom-right corner. It remembers its position for the session.
  You can change the shortcut at `chrome://extensions/shortcuts`.
- **Transform text**: type or paste into the note (it prefills with whatever you had selected),
  pick a mode chip, optionally add an instruction like "mention the deadline is Friday", and hit
  **Transform**. Each option has **Copy** and **Insert** — Insert replaces the selection in the
  input, textarea, or rich editor you were using when the note opened; if there is no editable
  target, WordGen copies the text and tells you so.
- **Selection bubble**: select text on any page and a small round "W" appears next to it. Click
  it to open the note prefilled with the selection. If the selection is a single word, the note
  opens directly in the synonyms view — click a candidate to replace the word in place (in
  editable fields) or copy it. The bubble can be turned off in the options page.
- **Right-click menu**: with text selected, the context menu offers "WordGen: Rewrite selection…"
  and "WordGen: Synonyms".
- **History**: the scroll icon in the note header shows your last 20 transforms; click one to
  restore it. The options page can clear all history.
- **Restricted pages**: content scripts cannot run on `chrome://` pages, the Chrome Web Store, or
  the built-in PDF viewer. There, the toolbar icon opens the same note in a small standalone
  window instead, so WordGen still works — you just copy results out rather than inserting them.

## Permissions, honestly explained

Chrome shows a scary-sounding warning when you install: **"Read and change all your data on all
websites."** Here is exactly why each permission exists:

- **Content script on all sites** (the source of that warning): the sticky note and the selection
  bubble are drawn by a script that must be present on the page you are viewing. It renders inside
  an isolated shadow DOM, does nothing until you interact with it, and never reads page content
  except the text you explicitly select or type into it.
- **storage**: saves your settings (synced with your Chrome profile) and your transform history
  (kept locally on the device).
- **activeTab** and **scripting**: let the toolbar button inject the note into tabs that were
  already open before you installed the extension, without a page reload.
- **contextMenus**: adds the two right-click items.
- **clipboardWrite**: powers the Copy buttons and the copy fallback when a page has no editable
  field to insert into.
- **Host access to `api.anthropic.com` and `api.openai.com`**: lets the background service worker
  call the provider you configured. Requests happen only when you press Transform, Synonyms, or
  Test connection — never in the background on their own.
- **Optional host access** (requested only if you save a custom or non-default endpoint in
  options): allows the background worker to reach your own server, a Groq endpoint, a local
  Ollama, etc. You approve the specific origin when you save it.

WordGen has no server of its own, no analytics, and no telemetry. Text you transform is sent only
to the provider you chose — or nowhere at all if you stay on the local engine.

## Bring your own key (BYOK)

Open the options page: right-click the WordGen icon and choose **Options**, or click the gear in
the note header. Out of the box the **Local** engine is selected — free, offline, good at
synonyms, grammar touch-ups, and simple rewrites, but limited for the AI-heavy modes (prompt
building, emails, expand).

**Claude (Anthropic)**

1. Create an API key at `console.anthropic.com` (Settings, then API keys).
2. In WordGen options, pick **Claude (Anthropic)** as the engine, paste the key, and choose a
   model — `claude-opus-4-8` for best quality, `claude-sonnet-5` for balance, or
   `claude-haiku-4-5` for speed.
3. Click **Test connection**, then **Save settings**.

**OpenAI, or anything OpenAI-compatible**

1. Pick **OpenAI-compatible**, paste your key, and set a model (default `gpt-4o-mini`).
2. The endpoint field defaults to OpenAI. Point it elsewhere for compatible services: Groq,
   Gemini's OpenAI-compatibility endpoint, or a local Ollama at
   `http://localhost:11434/v1/chat/completions` (no key needed for Ollama — put anything in the
   key field). Saving a non-default endpoint asks Chrome for permission to reach that host.
3. Test, then save.

**Custom endpoint**

Point WordGen at your own server. It POSTs JSON like
`{"action": "transform", "mode": "paraphrase", "text": "...", "opts": {}}` (or
`"action": "synonyms"` with `word` and `context`) with any headers you configure, and expects
`{"options": [{"text": "...", "note": "..."}]}` back (or `{"candidates": [...]}` for synonyms).
The `server/` folder in the repository has a small reference implementation.

**Where the key lives.** Your key is stored in Chrome's extension storage and, by default, synced
through your Google account so it follows you between machines. If you would rather keep it on one
device only, untick "Sync my API key" in options — the key then stays in this profile's local
storage. Either way it is only ever sent to the provider you configured.

## Themes

Three looks, shared with the web app and switchable in options: **Paper** (warm cream sticky
note, the default), **Ink** (flat near-black editorial), and **Mist** (cool airy light). The note
on the page follows whichever you pick.

## Troubleshooting

- **The note does not appear on a page.** Reload the page once after installing — tabs opened
  before the install do not have the content script yet (the toolbar button usually handles this
  automatically, but some pages block injection). On `chrome://` pages and the Web Store the
  standalone window opens instead; that is expected.
- **"This mode needs an AI provider" banner.** You are on the local engine and picked a mode it
  cannot do well. Add a key in options, or stick to synonyms/grammar/shorter/formal/casual.
- **401 or key errors.** Re-check the key in options and run Test connection — the error message
  passes through the provider's reason.
- **Custom endpoint requests fail.** Make sure you accepted the host-permission prompt when
  saving. You can re-trigger it by saving the options again.
- **Debugging.** The background worker's console is at `chrome://extensions` → WordGen →
  "Inspect views: service worker". The note's logs appear in the page's own DevTools console.

## Development notes

- `core/` and `assets/` in this folder are generated copies of `../core/` and four JSON files
  from `../assets/` — do not edit them here. Run `sync-core.sh` after changing the shared core.
- `icons/generate_icons.py` (requires Pillow) regenerates the toolbar PNGs and `icon.svg`.
- `content/note.js` is deliberately a classic (non-module) script — content scripts cannot be ES
  modules — and pulls the shared core in via dynamic `import(chrome.runtime.getURL(...))`. All
  other scripts are ES modules.
- All provider network calls happen in the background service worker; content scripts and
  extension pages only pass messages.
