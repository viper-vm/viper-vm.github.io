// Plumb — getting the findings back to where the work happens: a markups DXF to XREF over
// the drawing, a CSV for the issue log, and a printable coordination report.

import { DxfWriter } from './dxfwrite.js';
import { KIND, SEV_LABEL, floorName, levelTag, esc, PALETTES } from './style.js';

const ACI = { high: 1, medium: 30, low: 8, below: 4, accepted: 9, note: 7 };

/** Analysis metres → the drawing's own units and origin (per file when floors came as separate files). */
export function toDrawing(result, fi, x, y) {
  const f = result.floors[fi];
  if (f && f.origin) return [(x - f.origin[0]) / f.k, (y - f.origin[1]) / f.k, 1 / f.k];
  const k = result.unit.mm / 1000;
  return [x / k, y / k, 1 / k];
}

const ascii = (s) => String(s).replace(/→/g, '->').replace(/²/g, '2').replace(/×/g, 'x').replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...').replace(/[^\x20-\x7e]/g, '');

export function markupsDXF(result, dismissed, meta = {}) {
  const w = new DxfWriter();
  const multi = result.floors.some((f) => f.origin);
  const layerFor = (fi, what) => (multi ? `PLUMB-${levelTag(result.floors[fi])}-${what}` : `PLUMB-${what}`);
  const sevName = { high: 'HIGH', medium: 'MEDIUM', low: 'LOW' };
  for (const iss of result.issues) {
    const off = dismissed.has(iss.id);
    const upL = layerFor(iss.upper, off ? 'ACCEPTED' : sevName[iss.severity]);
    const loL = layerFor(iss.lower, off ? 'ACCEPTED' : 'BELOW');
    w.layer(upL, off ? ACI.accepted : ACI[iss.severity]);
    w.layer(loL, off ? ACI.accepted : ACI.below);

    // on the upper floor: a ring (double for high), a leader and a two-line tag
    const [x, y, u] = toDrawing(result, iss.upper, iss.at[0], iss.at[1]);
    const R = 0.7 * u;
    w.circle(x, y, R, upL);
    if (iss.severity === 'high' && !off) w.circle(x, y, R + 0.12 * u, upL);
    const a = Math.PI / 4, lx = x + Math.cos(a) * R, ly = y + Math.sin(a) * R;
    const tx = x + 1.35 * u, ty = y + 1.35 * u;
    w.line(lx, ly, tx, ty, upL).line(tx, ty, tx + 0.5 * u, ty, upL);
    w.text(tx + 0.65 * u, ty + 0.02 * u, 0.32 * u, ascii(`P${iss.n}  ${iss.title.toUpperCase()}`), upL);
    w.text(tx + 0.65 * u, ty - 0.42 * u, 0.2 * u, ascii(`${floorName(result.floors[iss.lower])} -> ${floorName(result.floors[iss.upper])} | ${iss.severity}${off ? ' | accepted' : ''} | Plumb`), upL);

    // on the lower floor: a dashed ring where the problem lands
    const [bx, by] = toDrawing(result, iss.lower, iss.atLower[0], iss.atLower[1]);
    for (let d = 0; d < 360; d += 30) w.arc(bx, by, R, d, d + 18, loL);
    w.text(bx + R + 0.2 * u, by - 0.1 * u, 0.22 * u, ascii(`P${iss.n} (from ${floorName(result.floors[iss.upper]).toLowerCase()}: ${iss.title.toLowerCase()})`), loL);
  }
  // a small header over each sheet
  const noteL = 'PLUMB-NOTE';
  w.layer(noteL, ACI.note);
  const heads = multi ? result.floors.map((f, fi) => [fi, f.box]) : [[0, [result.bounds.x0, result.bounds.y0, result.bounds.x1, result.bounds.y1]]];
  for (const [fi, box] of heads) {
    const [hx, hy, u] = toDrawing(result, fi, box[0], box[3] + (multi ? 1.5 : 3));
    w.text(hx, hy, 0.45 * u, ascii(`PLUMB vertical coordination markups - ${meta.file || 'drawing'} - ${meta.date || ''} - ${result.issues.length} issue(s)`), noteL);
  }
  return w.toString();
}

export function issuesCSV(result, dismissed) {
  const head = ['No', 'Severity', 'Type', 'Lower floor', 'Upper floor', 'Title', 'Detail', 'Where', 'For', 'X (drawing units)', 'Y (drawing units)', 'Lower X', 'Lower Y', 'Status'];
  const rows = [head];
  for (const iss of result.issues) {
    const [x, y] = toDrawing(result, iss.upper, iss.at[0], iss.at[1]);
    const [lx, ly] = toDrawing(result, iss.lower, iss.atLower[0], iss.atLower[1]);
    rows.push([
      `P${iss.n}`, iss.severity, iss.kind, floorName(result.floors[iss.lower]), floorName(result.floors[iss.upper]), iss.title, iss.detail, iss.where,
      (KIND[iss.kind] || {}).who || '', x.toFixed(1), y.toFixed(1), lx.toFixed(1), ly.toFixed(1), dismissed.has(iss.id) ? 'Accepted' : 'Open',
    ]);
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
const csvCell = (v) => { const s = String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/** Who needs to hear about what — the same findings, grouped the way a coordination meeting runs. */
export function memo(result, dismissed) {
  const open = result.issues.filter((i) => !dismissed.has(i.id));
  const by = new Map();
  for (const i of open) {
    const who = (KIND[i.kind] || {}).who || 'Architecture';
    if (!by.has(who)) by.set(who, []);
    by.get(who).push(i);
  }
  const order = ['Structure', 'Plumbing', 'Lifts', 'Architecture'];
  return order.filter((w) => by.has(w)).map((who) => ({
    who,
    items: by.get(who).map((i) => `P${i.n} — ${i.title} (${floorName(result.floors[i.lower])} → ${floorName(result.floors[i.upper])}, ${i.where})`),
  }));
}

export function reportHTML(result, dismissed, meta, snap) {
  const n = { high: 0, medium: 0, low: 0 };
  for (const i of result.issues) if (!dismissed.has(i.id)) n[i.severity]++;
  const pal = PALETTES.light;
  const floors = result.floors.map((f, k) => {
    const a = result.an[k], al = result.aligns[k];
    return `<tr><td>${esc(levelTag(f))}</td><td>${esc(floorName(f))}</td><td>${a.rooms.length}</td><td>${a.columns.length}</td><td>${a.footprintArea.toFixed(0)} m²</td><td>${al ? esc(al.method === 'columns' ? `${al.matched}/${al.of} columns` : al.method) : '—'}</td></tr>`;
  }).join('');
  const groups = memo(result, dismissed).map((g) => `<h2>${esc(g.who)}</h2><ul>${g.items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`).join('');
  const items = result.issues.map((iss) => {
    const [x, y] = toDrawing(result, iss.upper, iss.at[0], iss.at[1]);
    return `<div class="rp-iss">
      <img src="${snap(iss)}" alt="" />
      <div>
        <h3><span class="rp-n" style="background:${pal[iss.severity]}">${iss.n}</span>${esc(iss.title)}</h3>
        <p class="rp-where">${esc(floorName(result.floors[iss.lower]))} → ${esc(floorName(result.floors[iss.upper]))} · ${esc(iss.where)} · at ${x.toFixed(0)}, ${y.toFixed(0)} · ${esc((KIND[iss.kind] || {}).who || '')}</p>
        <p>${esc(iss.detail)}</p>
        <p class="rp-status">${esc(iss.severity.toUpperCase())} · ${esc(SEV_LABEL[iss.severity])} · ${dismissed.has(iss.id) ? 'Accepted as drawn' : 'Open'}</p>
      </div>
    </div>`;
  }).join('');
  return `
    <div class="rp-head">
      <div><h1>Vertical coordination report</h1><div>${esc(meta.file || '')}</div></div>
      <div class="rp-meta">Plumb · ${esc(meta.date || '')}<br>${result.floors.length} floors · units ${esc(meta.units || '')}</div>
    </div>
    <div class="rp-sum">
      <div><b>${n.high}</b>high</div><div><b>${n.medium}</b>medium</div><div><b>${n.low}</b>low</div><div><b>${dismissed.size}</b>accepted</div>
    </div>
    <table class="rp-floors"><thead><tr><th>Tag</th><th>Floor</th><th>Rooms</th><th>Columns</th><th>Footprint</th><th>Aligned on</th></tr></thead><tbody>${floors}</tbody></table>
    ${groups ? `<section class="rp-memo">${groups}</section>` : ''}
    ${meta.rfis && meta.rfis.length ? `<section class="rp-memo"><h2>Draft RFIs (written with Claude — review before sending)</h2>${meta.rfis.map((r) => `<div class="rp-rfi"><h3>${esc(r.to)} — ${esc(r.subject)}</h3><pre>${esc(r.body)}</pre></div>`).join('')}</section>` : ''}
    ${items || '<p>No vertical coordination issues found.</p>'}
    <div class="rp-foot">Generated by Plumb (viper-vm.github.io/demos/plumb) from the 2D plans alone. A coordination aid, not a structural or services design check — confirm every item with the responsible consultant.</div>`;
}

export function download(name, text, type = 'text/plain') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
