#!/usr/bin/env node
/**
 * India Infra Atlas — daily news fetcher.
 *
 * Reads RSS feeds (Google News queries + PIB), extracts infra/tech/defense
 * stories, geocodes them against a local gazetteer, and appends them to
 * demos/infra-atlas/data/news.json.
 *
 * Zero dependencies (Node 18+). If ANTHROPIC_API_KEY is set, new items are
 * enriched with Claude (better summaries, precise coordinates, benefits,
 * corridor route points); otherwise a keyword heuristic is used and items
 * without a confident location land in data/inbox.json for manual review.
 *
 * Usage:  node scripts/infra-atlas/fetch-news.mjs [--dry-run]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA = path.join(ROOT, "demos/infra-atlas/data");
const DRY = process.argv.includes("--dry-run");
const API_KEY = process.env.ANTHROPIC_API_KEY || "";
const MODEL = process.env.CLAUDE_MODEL || "claude-haiku-4-5-20251001";
const MAX_NEW_PER_RUN = 25;
const MAX_TOTAL_ITEMS = 2000;

const readJson = (p, d) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : d);
const feeds = readJson(path.join(DATA, "feeds.json"), { feeds: [] }).feeds;
const gazetteer = readJson(path.join(DATA, "gazetteer.json"), []);
const news = readJson(path.join(DATA, "news.json"), []);
const seen = new Set(readJson(path.join(DATA, "seen.json"), []));
const inbox = readJson(path.join(DATA, "inbox.json"), []);

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const titleKey = (s) => norm(s).split(" ").slice(0, 10).join(" ");
const slug = (s) => norm(s).split(" ").slice(0, 7).join("-");
news.forEach((n) => seen.add(titleKey(n.title)));

/* ---------------- RSS fetch & parse ---------------- */
async function fetchFeed(feed) {
  try {
    const res = await fetch(feed.url, {
      headers: { "User-Agent": "infra-atlas-bot/1.0 (github pages hobby project)" },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return parseRss(await res.text(), feed);
  } catch (e) {
    console.error(`  ! ${feed.name}: ${e.message}`);
    return [];
  }
}
function unesc(s) {
  return (s || "")
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'").replace(/&apos;/g, "'").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? unesc(m[1]) : "";
}
function parseRss(xml, feed) {
  const out = [];
  for (const m of xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)) {
    const b = m[0];
    let title = tag(b, "title");
    const srcName = tag(b, "source") || feed.name.replace(/^GNews · /, "");
    title = title.replace(/\s+-\s+[^-]{2,40}$/, ""); // strip " - Publisher" suffix
    const link = tag(b, "link");
    const desc = tag(b, "description").slice(0, 600);
    const pub = tag(b, "pubDate");
    const d = pub ? new Date(pub) : new Date();
    if (isNaN(+d)) continue;
    out.push({ title, link, desc, date: d.toISOString().slice(0, 10), srcName, hint: feed.hint });
  }
  return out;
}

/* ---------------- Heuristic extraction ---------------- */
const CAT_WORDS = {
  metro: ["metro", "rrts", "namo bharat", "light rail", "monorail"],
  roads: ["expressway", "highway", "nh-", "ring road", "flyover", "road tunnel", "bypass", "corridor road"],
  rail: ["railway", "rail line", "vande bharat", "amrit bharat", "bullet train", "freight corridor", "station redevelopment", "gauge", "locomotive", "trainset"],
  aviation: ["airport", "terminal", "runway", "airstrip", "heliport", "udan"],
  ports: ["port", "berth", "shipyard", "transshipment", "dry dock", "container terminal", "waterway"],
  energy: ["solar", "wind", "hydro", "nuclear", "reactor", "biogas", "cbg", "hydrogen", "transmission", "power plant", "thermal", "renewable", "gw ", "mw "],
  defense: ["drdo", "missile", "defence", "defense", "navy", "warship", "submarine", "fighter", "army", "air force", "brahmos", "tejas", "induction"],
  tech: ["semiconductor", "fab", "chip", "data center", "data centre", "electronics manufacturing", "gigafactory", "isro", "spaceport", "satellite launch"],
  water: ["dam", "irrigation", "river linking", "water supply", "desalination", "barrage", "canal", "jal jeevan"],
};
const STATUS_WORDS = [
  ["inaugurated", ["inaugurat", "opens to", "opened", "flagg", "dedicated to the nation", "commission"]],
  ["approved", ["approv", "clears", "cleared", "sanction", "nod", "cabinet", "greenlight"]],
  ["under-construction", ["construction", "groundbreaking", "foundation stone", "bhoomi", "work begins", "breakthrough", "boring"]],
  ["test", ["test-fired", "test fired", "flight test", "successfully tested", "trial launch", "user trial"]],
  ["trial", ["trial run", "trials", "prototype", "rolled out"]],
  ["operational", ["operational", "begins operations", "enters service", "goes live"]],
];
function classify(text, hint) {
  const t = " " + norm(text) + " ";
  let best = hint || null, bestN = 0;
  for (const [cat, words] of Object.entries(CAT_WORDS)) {
    const n = words.reduce((s, w) => s + (t.includes(w) ? 1 : 0), 0);
    if (n > bestN) { bestN = n; best = cat; }
  }
  return best;
}
function detectStatus(text) {
  const t = norm(text);
  for (const [status, words] of STATUS_WORDS) if (words.some((w) => t.includes(w))) return status;
  return "announced";
}
function extractInvestment(text) {
  const m = text.match(/(?:₹|rs\.?|rupees)\s?([\d,]+(?:\.\d+)?)\s*(lakh\s+crore|crore|cr\b)/i);
  if (!m) return null;
  let v = parseFloat(m[1].replace(/,/g, ""));
  if (/lakh/i.test(m[2])) v *= 100000;
  return isFinite(v) && v > 0 ? v : null;
}
function extractCapacity(text) {
  const m = text.match(/([\d,]+(?:\.\d+)?)\s?(gw|mw|km|tonnes?|tpd|mtpa|teu|stations|lakh\s+passengers)/i);
  return m ? `${m[1]} ${m[2].toUpperCase()}` : null;
}
function locate(title, desc) {
  const hayT = " " + norm(title) + " ";
  const hayD = " " + norm(desc) + " ";
  let best = null, bestLen = 0, inTitle = false;
  for (const p of gazetteer) {
    for (const name of [p.name, ...(p.aliases || [])]) {
      const n = " " + norm(name) + " ";
      if (n.trim().length < 4 && name !== "Goa") continue; // skip too-short/ambiguous
      const t = hayT.includes(n), d = hayD.includes(n);
      if (!t && !d) continue;
      const score = n.length + (t ? 100 : 0);
      if (score > bestLen) { bestLen = score; best = p; inTitle = t; }
    }
  }
  return best ? { name: best.name, state: best.state, lat: best.lat, lng: best.lng, confident: inTitle } : null;
}

/* ---------------- Claude enrichment (optional) ---------------- */
async function enrichWithClaude(items) {
  const prompt = `You are enriching Indian infrastructure news for a map. For each item below, return a JSON array (same order, same length). Each element:
{"keep": true|false, "category": "metro|roads|rail|aviation|ports|energy|defense|tech|water",
 "status": "announced|approved|under-construction|inaugurated|operational|test|trial",
 "title": "cleaned headline", "summary": "2-3 factual sentences with key numbers",
 "locationName": "project site", "state": "full state name", "lat": 0.0, "lng": 0.0,
 "investmentCr": number|null, "capacity": "string"|null,
 "benefits": ["2-4 short impact bullets"], "project": "human project name for grouping",
 "routePoints": [[lng,lat],...]|null }
Rules: keep=false for items that are not a concrete Indian infrastructure/technology/defense project development (opinion pieces, market roundups, foreign news). lat/lng must be the real project site inside India from your geographic knowledge. routePoints only for linear corridors (4-8 waypoints). Respond with ONLY the JSON array.

ITEMS:
${JSON.stringify(items.map((i) => ({ title: i.title, description: i.desc, date: i.date })), null, 1)}`;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 8000, messages: [{ role: "user", content: prompt }] }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error("Claude API " + res.status + " " + (await res.text()).slice(0, 200));
  const data = await res.json();
  const text = (data.content || []).map((c) => c.text || "").join("");
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) throw new Error("no JSON array in Claude response");
  return JSON.parse(m[0]);
}

/* ---------------- Main ---------------- */
const fresh = [];
console.log(`Polling ${feeds.length} feeds…`);
for (const feed of feeds) {
  const items = await fetchFeed(feed);
  let n = 0;
  for (const it of items) {
    const key = titleKey(it.title);
    if (!it.title || it.title.length < 25 || seen.has(key)) continue;
    seen.add(key);
    fresh.push(it);
    n++;
  }
  console.log(`  ✓ ${feed.name}: ${items.length} items, ${n} new`);
}
console.log(`${fresh.length} new candidate stories`);
fresh.splice(MAX_NEW_PER_RUN); // keep runs bounded

let enriched = null;
if (API_KEY && fresh.length) {
  try {
    enriched = await enrichWithClaude(fresh);
    console.log("Claude enrichment ok");
  } catch (e) {
    console.error("Claude enrichment failed, falling back to heuristics:", e.message);
  }
}

const added = [], parked = [];
fresh.forEach((it, i) => {
  const ai = enriched && enriched[i] && typeof enriched[i] === "object" ? enriched[i] : null;
  if (ai && ai.keep === false) return;
  const text = it.title + ". " + it.desc;
  const category = (ai && ai.category) || classify(text, it.hint);
  if (!category) return;
  let loc = null;
  if (ai && isFinite(ai.lat) && isFinite(ai.lng) && ai.lat > 6 && ai.lat < 37.5 && ai.lng > 67.5 && ai.lng < 98) {
    loc = { name: ai.locationName || "India", state: ai.state || "", lat: +(+ai.lat).toFixed(5), lng: +(+ai.lng).toFixed(5) };
  } else {
    const g = locate(it.title, it.desc);
    if (g && (g.confident || it.hint)) loc = { name: g.name, state: g.state, lat: g.lat, lng: g.lng };
  }
  const rec = {
    id: `${it.date}-${slug((ai && ai.title) || it.title)}`,
    date: it.date,
    title: (ai && ai.title) || it.title,
    summary: (ai && ai.summary) || it.desc || it.title,
    category,
    status: (ai && ai.status) || detectStatus(text),
    location: loc,
    investmentCr: (ai && ai.investmentCr) ?? extractInvestment(text),
    capacity: (ai && ai.capacity) ?? extractCapacity(text),
    benefits: (ai && ai.benefits) || [],
    project: (ai && ai.project) || null,
    sources: [{ name: it.srcName || "source", url: it.link }],
    routePoints: (ai && Array.isArray(ai.routePoints) && ai.routePoints.length >= 2) ? ai.routePoints : null,
  };
  if (!rec.location) { parked.push(rec); return; }
  if (news.some((n) => n.id === rec.id)) rec.id += "-" + Math.floor(Math.random() * 999);
  added.push(rec);
});

news.unshift(...added);
news.sort((a, b) => (a.date < b.date ? 1 : -1));
news.splice(MAX_TOTAL_ITEMS);
const seenArr = [...seen].slice(-8000);
const newInbox = [...parked, ...inbox].slice(0, 100);

console.log(`→ ${added.length} stories added to the atlas, ${parked.length} parked in inbox (no confident location)`);
if (DRY) {
  console.log(JSON.stringify(added, null, 1));
} else {
  writeFileSync(path.join(DATA, "news.json"), JSON.stringify(news, null, 1));
  writeFileSync(path.join(DATA, "seen.json"), JSON.stringify(seenArr));
  writeFileSync(path.join(DATA, "inbox.json"), JSON.stringify(newInbox, null, 1));
  writeFileSync(path.join(DATA, "meta.json"), JSON.stringify({ updatedAt: new Date().toISOString(), total: news.length, lastRunAdded: added.length }));
}
