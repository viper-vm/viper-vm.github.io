// Plumb — the landing page: choose or drop drawings to start a project, or open the sample building.

import { injectIcons, $, $$, toast, busy, onDropFiles, themeNow, setTheme } from '../shell/ui.js';
import { pendDrawings } from '../shell/store.js';

injectIcons();
$$('[data-theme-icon]').forEach((u) => u.setAttribute('href', themeNow() === 'dark' ? '#i-sun' : '#i-moon'));
$('#themeBtn').addEventListener('click', () => setTheme(themeNow() === 'dark' ? 'light' : 'dark'));

// hero picture: the floors checked, or the 3D model
const hv = $('#heroVis');
hv.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-hv]');
  if (!b) return;
  for (const el of $$('[data-hv]', hv)) {
    const on = el.dataset.hv === b.dataset.hv;
    if (el.tagName === 'FIGCAPTION') el.hidden = !on; else el.classList.toggle('on', on);
  }
});

// a new project: the drawings go to the import wizard through this browser's storage
const picker = Object.assign(document.createElement('input'), { type: 'file', multiple: true, accept: '.dwg,.DWG,.dxf,.DXF', hidden: true });
document.body.appendChild(picker);
picker.addEventListener('change', () => { if (picker.files.length) start([...picker.files]); picker.value = ''; });
for (const b of $$('#pickBtn, [data-pick]')) b.addEventListener('click', () => picker.click());

async function start(files) {
  busy('Opening the drawings…');
  try {
    if (await pendDrawings(files)) { location.href = 'app/import.html'; return; }
    busy(null); toast('Plumb reads DWG and DXF drawings. Export one from your CAD app.', true);
  } catch (err) { busy(null); toast(err.message, true); }
}
onDropFiles(start);
