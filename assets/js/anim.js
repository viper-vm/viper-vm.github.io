// Rotating headline
export function rotateWords(el, words, interval=1800){
  if(!el || !words?.length) return;
  let i = 0;
  el.textContent = words[i];
  setInterval(()=>{
    i = (i+1) % words.length;
    el.style.opacity = 0;
    setTimeout(()=>{ el.textContent = words[i]; el.style.opacity = 1; }, 250);
  }, interval);
}

// Animated counters
export function countUp(el, end, duration=1200, decimals=0){
  if(!el) return;
  const startTime = performance.now();
  function frame(now){
    const p = Math.min((now - startTime) / duration, 1);
    const val = (end * p);
    el.textContent = decimals ? val.toFixed(decimals) : Math.round(val);
    if(p < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// On visible helper
export function onVisible(el, cb, options={threshold:0.3}){
  const io = new IntersectionObserver((entries)=>{
    entries.forEach(e=>{ if(e.isIntersecting){ cb(); io.disconnect(); } });
  }, options);
  io.observe(el);
}
