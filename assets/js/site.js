
document.addEventListener('DOMContentLoaded',()=>{
  const btn=document.getElementById('themeToggle');
  const current=localStorage.getItem('theme')||'dark';
  if(current==='dark') document.documentElement.classList.add('dark');
  if(btn){ btn.addEventListener('click',()=>{
    document.documentElement.classList.toggle('dark');
    const d=document.documentElement.classList.contains('dark');
    localStorage.setItem('theme', d?'dark':'light');
  });}
});
// Load curated projects into a grid id='pinned-grid'
async function loadPinned(){
  const grid=document.getElementById('pinned-grid'); if(!grid) return;
  const pinned=await fetch('/assets/data/pinned.json').then(r=>r.json()).catch(()=>[]);
  function card(p){
    return `<div class="tile">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
        <h3><a href="${p.url}" target="_blank" rel="noreferrer">${p.name}</a></h3>
        <span class="badge">${p.tag||p.lang||''}</span>
      </div>
      <p class="subtitle" style="margin:0">${p.description||''}</p>
      <div class="meta"><span>⭐ ${p.stars||0}</span>${p.year?`<span>• ${p.year}</span>`:''}</div>
    </div>`;
  }
  pinned.forEach(p=> grid.insertAdjacentHTML('beforeend', card(p)));
}
// Load demos as cards from demos.json
async function loadDemos(){
  const grid=document.getElementById('demos-grid'); if(!grid) return;
  const demos=await fetch('/assets/data/demos.json').then(r=>r.json()).catch(()=>[]);
  function card(d){
    const href = `/demos/viewer.html?id=${encodeURIComponent(d.id)}`;
    return `<div class="tile">
      <div class="badge">${d.category||'Demo'}</div>
      <h3 style="margin:6px 0 6px">${d.title}</h3>
      <p class="subtitle" style="margin:0 0 8px">${d.summary||''}</p>
      <div class="meta">
        ${d.repo?`<a class="badge" href="${d.repo}" target="_blank">Repo</a>`:''}
        <a class="btn" style="margin-top:6px" href="${href}">Open Live</a>
      </div>
    </div>`;
  }
  demos.forEach(d=> grid.insertAdjacentHTML('beforeend', card(d)));
}
// Load GitHub feed to a grid id='projects-grid' (plus pinned.json first)
async function loadProjects(){
  const grid=document.getElementById('projects-grid'); if(!grid) return;
  const pinned=await fetch('/assets/data/pinned.json').then(r=>r.json()).catch(()=>[]);
  function tile(p){
    return `<div class="tile">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
        <h3 style="margin:0"><a href="${p.url||p.html_url}" target="_blank">${p.name}</a></h3>
        <span class="badge">${p.tag||p.language||''}</span>
      </div>
      <p class="subtitle" style="margin:0">${p.description||''}</p>
      <div class="meta">⭐ ${p.stars ?? p.stargazers_count ?? 0}</div>
    </div>`;
  }
  pinned.forEach(p=> grid.insertAdjacentHTML('beforeend', tile(p)));
  try{
    const repos=await fetch('https://api.github.com/users/viper-vm/repos?sort=updated&per_page=12').then(r=>r.json());
    repos.filter(r=>!r.fork).slice(0,9).forEach(r=> grid.insertAdjacentHTML('beforeend', tile(r)));
  }catch(e){}
}
