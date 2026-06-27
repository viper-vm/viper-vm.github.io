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

  /* ---------- Year stamp ---------- */
  $$("[data-year]").forEach((el) => { el.textContent = new Date().getFullYear(); });
})();
