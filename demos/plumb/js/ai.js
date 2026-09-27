// Plumb — optional Claude assist, with your own Anthropic API key, called straight from the
// browser (Plumb has no server). Two jobs where a language model beats rules:
//   1. read unusual layer names and room labels (abbreviations, other languages, office codes)
//   2. turn the findings into RFIs for each consultant
// Only names, counts and the findings are sent — never the drawing geometry.

import { ROLES, ROOM_TYPES } from './recognize.js';
import { floorName } from './style.js';

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.128.0/+esm';
const MODEL = 'claude-opus-5';

let sdk = null;
async function load() {
  sdk ||= import(SDK_URL).then((m) => m.default);
  return sdk;
}

async function ask(apiKey, { system, user, schema, effort, maxTokens = 16000, signal }) {
  const Anthropic = await load();
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
  let res;
  try {
    res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      // if Opus 5 declines, the API retries on Anthropic's recommended fallback model
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort, format: { type: 'json_schema', schema } },
      system,
      messages: [{ role: 'user', content: user }],
    }, { signal });
  } catch (e) {
    throw new Error(explain(Anthropic, e));
  }
  if (res.stop_reason === 'refusal') throw new Error('Claude declined this request.');
  if (res.stop_reason === 'max_tokens') throw new Error('The answer was cut off (too long). Try again with fewer layers.');
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  try { return JSON.parse(text); } catch { throw new Error('Claude replied in an unexpected format — try again.'); }
}

function explain(Anthropic, e) {
  if (e instanceof Anthropic.AuthenticationError) return 'That API key was rejected — check it at console.anthropic.com.';
  if (e instanceof Anthropic.PermissionDeniedError) return 'This key isn’t allowed to use Claude Opus 5.';
  if (e instanceof Anthropic.RateLimitError) return 'Rate limited by the API — wait a minute and try again.';
  if (e instanceof Anthropic.APIUserAbortError) return 'Cancelled.';
  if (e instanceof Anthropic.APIConnectionError) return 'Couldn’t reach api.anthropic.com — check your connection.';
  if (e instanceof Anthropic.APIError) {
    if (e.type === 'billing_error') return 'The API account has no credit left.';
    if (e.type === 'overloaded_error' || (e.status || 0) >= 500) return 'Anthropic’s API is busy right now — try again shortly.';
    return `API error ${e.status || ''}: ${String(e.message).slice(0, 180)}`;
  }
  return String(e && e.message ? e.message : e);
}

// ---------------------------------------------------------------------------- naming

const NAMING_SYSTEM = `You help Plumb, a browser tool that stacks the floor plans of a building from a DXF file and checks what should line up between floors (columns, wet rooms over bedrooms, ducts, lifts, stairs, slab edges).

Plumb guesses what each CAD layer holds and what each room label means with simple rules, which fail on office-specific layer codes, abbreviations (M.B.R., K.T., W.C., D.R., T&B, OTS, C.B.) and labels in other languages (Hindi, Marathi, Tamil, Arabic, German, Spanish, French…). You get every layer with counts of what is drawn on it and Plumb's current guess, plus every room label with its current guess, and you return only the corrections.

Layer roles:
- wall: walls and partitions, including solid poché fills
- column: structural columns / pillars / piers (small closed rectangles or circles, often filled)
- door: door leaves and swing arcs
- window: windows, glazing, ventilators, curtain walls
- outline: slab edges, balcony/projection outlines, "above"/"below" dashed outlines
- stair: stair treads, flights, ramps
- lift: lift cars, lift shafts
- duct: ducts, shafts, plumbing risers, open-to-sky cutouts
- furniture: furniture, sanitary fixtures, kitchen equipment, cars, trees
- text: annotation and room-name text
- dim: dimensions
- hatch: decorative hatch patterns
- grid: structural grid / centre lines
- other: anything Plumb should ignore (title blocks, borders, viewports, other disciplines' xrefs)

Room types: toilet (any WC, bath, shower, powder room), kitchen (kitchen, utility, wash area, pantry), bedroom, living (living, drawing, dining, family, study, office, puja/prayer), circulation (lobby, passage, corridor, foyer, entrance), balcony (balcony, terrace, sit-out, veranda, deck), stair, lift, duct (duct, shaft, OTS), service (store, electrical, pump, dress, servant, guard), parking, unknown.

Change something only when you are confident the current guess is wrong; when a name is ambiguous, leave it. Keep "why" to a few words.`;

const NAMING_SCHEMA = {
  type: 'object',
  properties: {
    layers: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, role: { type: 'string', enum: ROLES }, why: { type: 'string' } },
        required: ['name', 'role', 'why'],
        additionalProperties: false,
      },
    },
    rooms: {
      type: 'array',
      items: {
        type: 'object',
        properties: { label: { type: 'string' }, type: { type: 'string', enum: ROOM_TYPES }, why: { type: 'string' } },
        required: ['label', 'type', 'why'],
        additionalProperties: false,
      },
    },
    notes: { type: 'string' },
  },
  required: ['layers', 'rooms', 'notes'],
  additionalProperties: false,
};

/** What the drawing's names look like, without any geometry. */
export function namingPayload(result) {
  const layers = result.layers
    .filter((l) => l.stats && l.stats.segs + l.stats.arcs + l.stats.texts + l.stats.fills > 0)
    .map((l) => ({
      name: l.name, current: l.role,
      lines: l.stats.segs, arcs: l.stats.arcs, doorLikeArcs: l.stats.doorArcs, texts: l.stats.texts, fills: l.stats.fills,
      smallSquareFills: l.stats.colFills, axisAligned: l.stats.segs ? Math.round((l.stats.axis / l.stats.segs) * 100) + '%' : '—',
    }));
  const labels = new Map();
  result.an.forEach((a) => {
    for (const r of a.rooms) {
      const lab = (r.label || '').trim();
      if (!lab) continue;
      const o = labels.get(lab) || { label: lab, current: r.type, count: 0, areas: [] };
      o.count++; o.areas.push(+r.area.toFixed(1));
      labels.set(lab, o);
    }
  });
  const rooms = [...labels.values()].map((o) => ({ label: o.label, current: o.current, count: o.count, typicalArea_m2: o.areas.sort((p, q) => p - q)[Math.floor(o.areas.length / 2)] }));
  return { floors: result.floors.map((f) => f.title), layers, rooms };
}

export async function readNaming(apiKey, result, signal) {
  const payload = namingPayload(result);
  const out = await ask(apiKey, {
    system: NAMING_SYSTEM,
    user: `Here are the layers and room labels from the drawing. Return only the ones Plumb has wrong.\n\n${JSON.stringify(payload)}`,
    schema: NAMING_SCHEMA,
    effort: 'low',
    signal,
  });
  // keep only real changes to names that exist
  const layerNames = new Map(payload.layers.map((l) => [l.name, l.current]));
  const roomLabels = new Map(payload.rooms.map((r) => [r.label, r.current]));
  return {
    layers: out.layers.filter((l) => layerNames.has(l.name) && layerNames.get(l.name) !== l.role).map((l) => ({ ...l, from: layerNames.get(l.name) })),
    rooms: out.rooms.filter((r) => roomLabels.has(r.label) && roomLabels.get(r.label) !== r.type).map((r) => ({ ...r, from: roomLabels.get(r.label) })),
    notes: out.notes,
    sent: { layers: payload.layers.length, rooms: payload.rooms.length },
  };
}

// ---------------------------------------------------------------------------- RFIs

const RFI_SYSTEM = `You write coordination RFIs (requests for information) that an architect sends to consultants. The findings come from Plumb, which compared a building's 2D floor plans floor by floor. Each finding has an id like P3, a kind, the two floors involved, where it is on the plan and what Plumb measured.

Write one RFI per consultant who has findings: "Structural engineer" (floating columns, column offsets, columns growing, cantilevers/overhangs), "Plumbing / MEP engineer" (wet rooms over bedrooms or living rooms, ducts that shift or stop), "Lift consultant" (lift wells), "Architect (internal)" (stairs, and anything that needs a re-plan). For each RFI give a short subject and a body: one opening sentence, then a numbered list with one item per finding — the finding id, floors, location, what was found, and the specific question or the drawing/detail needed to close it. Close with a one-line request for a reply. Plain, professional, specific; no speculation beyond the findings, no pleasantries. Mention once that the findings come from an automated check of the 2D plans and need confirming.`;

const RFI_SCHEMA = {
  type: 'object',
  properties: {
    rfis: {
      type: 'array',
      items: {
        type: 'object',
        properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' }, issues: { type: 'array', items: { type: 'string' } } },
        required: ['to', 'subject', 'body', 'issues'],
        additionalProperties: false,
      },
    },
  },
  required: ['rfis'],
  additionalProperties: false,
};

export async function draftRFIs(apiKey, result, accepted, meta, signal) {
  const open = result.issues.filter((i) => !accepted.has(i.id));
  const findings = open.map((i) => ({
    id: `P${i.n}`, kind: i.kind, severity: i.severity,
    floors: `${floorName(result.floors[i.lower])} → ${floorName(result.floors[i.upper])}`,
    where: i.where, title: i.title, detail: i.detail,
  }));
  const out = await ask(apiKey, {
    system: RFI_SYSTEM,
    user: `Project drawing: ${meta.file}. Floors: ${result.floors.map((f) => floorName(f)).join(', ')}.\n\nFindings:\n${JSON.stringify(findings, null, 1)}`,
    schema: RFI_SCHEMA,
    effort: 'medium',
    signal,
  });
  return out.rfis;
}
