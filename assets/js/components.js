
function renderHeader(active){
  const el=document.getElementById('site-header'); if(!el) return;
  el.innerHTML=`<div class='navwrap'><div class='container nav'>
    <a href='/' class='brand'><span class='brand-badge'>⚡</span> viper-vm</a>
    <nav>
      <a href='/' ${active==='home'?'class="active"':''}>Home</a>
      <a href='/projects/' ${active==='projects'?'class="active"':''}>Projects</a>
      <a href='/demos/' ${active==='demos'?'class="active"':''}>Live Demos</a>
      <a href='/resume/' ${active==='resume'?'class="active"':''}>Resume</a>
      <a href='/contact/' ${active==='contact'?'class="active"':''}>Contact</a>
    </nav>
    <button id='themeToggle' class='btn' aria-label='Toggle theme'>🌓</button>
  </div></div>`;
}
function renderFooter(){
  const el=document.getElementById('site-footer'); if(!el) return;
  const y=new Date().getFullYear();
  el.innerHTML=`<div class='container' style='display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap'>
    <div>© ${y} <b>Vivek Modi</b> — Built with ❤️ and GitHub Pages.</div>
    <div style='display:flex;gap:8px;flex-wrap:wrap'>
      <a class='badge' href='mailto:vivekvm8400@gmail.com'>Email</a>
      <a class='badge' href='https://github.com/viper-vm' target='_blank' rel='noreferrer'>GitHub</a>
      <a class='badge' href='https://www.linkedin.com/in/vivek-modi1' target='_blank' rel='noreferrer'>LinkedIn</a>
    </div>
  </div>`;
}
