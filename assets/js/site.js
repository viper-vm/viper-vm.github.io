/* ============================================================
   Vivek Modi — Portfolio · shared site behaviour
   (Theme init lives inline in <head> to avoid a flash; this
    file handles toggling, nav, reveals, counters, forms.)
   ============================================================ */
(function () {
  "use strict";

  const root = document.documentElement;
  const $  = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let starfieldEnsure = null; // set once the starfield is initialised

  /* ---------- Theme toggle ---------- */
  function applyThemeIcon(theme) {
    $$("[data-theme-icon]").forEach((el) => {
      el.innerHTML = theme === "light"
        ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>'
        : '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
    });
  }
  function currentTheme() { return root.getAttribute("data-theme") || "dark"; }
  applyThemeIcon(currentTheme());

  $$("[data-theme-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = currentTheme() === "light" ? "dark" : "light";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem("theme", next); } catch (e) {}
      applyThemeIcon(next);
      if (starfieldEnsure) starfieldEnsure(); // (re)start sparkles when entering dark
    });
  });

  /* ---------- Header shadow on scroll ---------- */
  const header = $(".site-header");
  if (header) {
    const onScroll = () => header.classList.toggle("scrolled", window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  /* ---------- Mobile drawer ---------- */
  const drawer = $(".mobile-drawer");
  const scrim  = $(".scrim");
  const openMenu  = () => { drawer && drawer.classList.add("open"); scrim && scrim.classList.add("show"); document.body.style.overflow = "hidden"; };
  const closeMenu = () => { drawer && drawer.classList.remove("open"); scrim && scrim.classList.remove("show"); document.body.style.overflow = ""; };
  $$("[data-menu-open]").forEach((b) => b.addEventListener("click", openMenu));
  $$("[data-menu-close]").forEach((b) => b.addEventListener("click", closeMenu));
  scrim && scrim.addEventListener("click", closeMenu);
  drawer && $$("a", drawer).forEach((a) => a.addEventListener("click", closeMenu));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });

  /* ---------- Scroll reveal ---------- */
  const reveals = $$(".reveal");
  if (reveals.length && "IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e, i) => {
        if (e.isIntersecting) {
          const el = e.target;
          const delay = parseFloat(el.getAttribute("data-delay") || "0");
          setTimeout(() => el.classList.add("in"), delay * 1000);
          io.unobserve(el);
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
    reveals.forEach((el) => io.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add("in"));
  }

  /* ---------- Active section in nav ---------- */
  const navLinks = $$(".nav-links a[href^='#'], .nav-links a[href*='/#']");
  const sections = $$("section[id], main[id]");
  if (navLinks.length && sections.length && "IntersectionObserver" in window) {
    const setActive = (id) => navLinks.forEach((a) => {
      const href = a.getAttribute("href") || "";
      a.classList.toggle("active", href.endsWith("#" + id));
    });
    const io2 = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) setActive(e.target.id); });
    }, { rootMargin: "-45% 0px -50% 0px" });
    sections.forEach((s) => io2.observe(s));
  }

  /* ---------- Animated stat counters ---------- */
  function countUp(el) {
    const target  = parseFloat(el.getAttribute("data-count"));
    const decimals = parseInt(el.getAttribute("data-decimals") || "0", 10);
    const prefix  = el.getAttribute("data-prefix") || "";
    const suffix  = el.getAttribute("data-suffix") || "";
    const dur = 1400; const start = performance.now();
    function frame(now) {
      const p = Math.min((now - start) / dur, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      const val = (target * eased).toFixed(decimals);
      el.textContent = prefix + val + suffix;
      if (p < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }
  const counters = $$("[data-count]");
  if (counters.length && "IntersectionObserver" in window) {
    const io3 = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { countUp(e.target); io3.unobserve(e.target); } });
    }, { threshold: 0.5 });
    counters.forEach((el) => io3.observe(el));
  } else {
    counters.forEach((el) => el.textContent = (el.getAttribute("data-prefix") || "") + el.getAttribute("data-count") + (el.getAttribute("data-suffix") || ""));
  }

  /* ---------- Contact form -> mailto ---------- */
  const form = $("#contactForm");
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const to = form.getAttribute("data-to") || "vivekvm84001@gmail.com";
      const name = ($("#name", form) || {}).value || "";
      const email = ($("#email", form) || {}).value || "";
      const message = ($("#message", form) || {}).value || "";
      const subject = encodeURIComponent("Portfolio contact from " + name.trim());
      const body = encodeURIComponent("From: " + name.trim() + " <" + email.trim() + ">\n\n" + message.trim());
      window.location.href = "mailto:" + to + "?subject=" + subject + "&body=" + body;
      form.reset();
    });
  }

  /* ---------- Ambient background: olive orbs + dark-mode starfield ---------- */
  function initBackground() {
    if ($(".bg-layer")) return;
    const layer = document.createElement("div");
    layer.className = "bg-layer";
    layer.setAttribute("aria-hidden", "true");
    layer.innerHTML =
      '<div class="bg-orb bg-orb-1"></div>' +
      '<div class="bg-orb bg-orb-2"></div>' +
      (reduceMotion ? "" : '<canvas id="starfield"></canvas>');
    document.body.insertBefore(layer, document.body.firstChild);

    const canvas = $("#starfield", layer);
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let stars = [], W = 0, H = 0, raf = null;

    function build() {
      W = canvas.clientWidth; H = canvas.clientHeight;
      canvas.width = W * dpr; canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.max(40, Math.min(150, Math.floor((W * H) / 9000)));
      stars = [];
      for (let i = 0; i < count; i++) {
        stars.push({
          x: Math.random() * W, y: Math.random() * H,
          r: Math.random() * 1.2 + 0.3,
          phase: Math.random() * Math.PI * 2,
          speed: Math.random() * 0.015 + 0.004,
          base: Math.random() * 0.5 + 0.35
        });
      }
    }
    function render() {
      ctx.clearRect(0, 0, W, H);
      for (let i = 0; i < stars.length; i++) {
        const s = stars[i];
        s.phase += s.speed;
        const a = s.base * ((Math.sin(s.phase) + 1) / 2);
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, 6.2832);
        ctx.fillStyle = "rgba(214, 226, 150, " + a.toFixed(3) + ")";
        ctx.shadowBlur = s.r * 4;
        ctx.shadowColor = "rgba(155, 197, 58, " + (a * 0.7).toFixed(3) + ")";
        ctx.fill();
      }
      ctx.shadowBlur = 0;
    }
    function loop() {
      if (currentTheme() !== "dark") { ctx.clearRect(0, 0, W, H); raf = null; return; }
      render();
      raf = requestAnimationFrame(loop);
    }
    starfieldEnsure = function () {
      if (currentTheme() !== "dark") return;
      render();                                   // paint one frame immediately
      if (!raf) raf = requestAnimationFrame(loop); // then animate while visible
    };
    let rt = null;
    window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(build, 200); }, { passive: true });
    build();
    starfieldEnsure();
  }
  initBackground();

  /* ---------- Year stamp ---------- */
  $$("[data-year]").forEach((el) => { el.textContent = new Date().getFullYear(); });
})();
