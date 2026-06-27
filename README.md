# viper-vm.github.io

Personal portfolio of **Vivek Modi** — Machine Learning Engineer.
Static site (HTML / CSS / vanilla JS), no build step, hosted on GitHub Pages.

**Live:** https://viper-vm.github.io/

## Structure

```
index.html              Single-page portfolio (hero, about, skills, experience, projects, contact)
demos/                  Live in-browser demos + the apps themselves
  index.html            Demo gallery (cards generated from assets/data/demos.json)
  india-energy/ diff/ wordgen/   Standalone demo apps
  jwt.html  wordle.html          Single-file demos
resume/index.html       Résumé page (ML / Software / Master PDFs)
assets/
  css/style.css         The single shared design system ("Slate + Teal", light/dark)
  js/site.js            Shared behaviour: theme toggle, mobile nav, scroll reveal, counters, contact form
  img/                  Photo + favicon
  data/demos.json       Demo gallery entries
  resume/               Résumé PDFs
about/ projects/ case-studies/ contact/ playground/   Redirect stubs → homepage sections
```

## Customize

- **Demos:** edit `assets/data/demos.json` (title, category, summary, emoji, demo_url, optional repo).
- **Projects grid:** edit the `OTHER_PROJECTS` array near the bottom of `index.html`.
- **Experience / about / skills / stats:** edit the matching sections in `index.html`.
- **Theme & components:** colors and components live in `assets/css/style.css` (CSS variables at the top).
- **Photo:** replace `assets/img/vivek.jpg`. **Résumés:** drop PDFs in `assets/resume/`.

## Local preview

```bash
python3 -m http.server 8099
# then open http://localhost:8099
```
