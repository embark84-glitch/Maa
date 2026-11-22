'use strict';
/* Bundle the web client + in-browser demo backend into one self-contained HTML file. */
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const safe = (js) => js.replace(/<\/script/gi, '<\\/script');

const css = read('public/styles.css') + `
.demo-bar { background: var(--brand-soft); color: var(--text); font-size: .85rem; padding-block: .45rem;
  padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px));
  display: flex; gap: .75rem; align-items: center; justify-content: center; flex-wrap: wrap; text-align: center; }
.demo-bar button { font-size: .8rem; padding: .2rem .6rem; }`;

const app = read('public/app.js')
  ;

let html = read('public/index.html')
  .replace('<title>Maa · Pharmacy Supply</title>', '<title>Maa Pharmacy Supply</title>')
  .replace('<link rel="stylesheet" href="styles.css">', () => `<style>\n${css}\n</style>`)
  .replace('<body>', () => `<body>
  <div class="demo-bar"><span data-t="Demo version: runs entirely in your browser, data stays on this device."></span>
    <button type="button" onclick="maaResetDemo()" data-t="Reset demo data"></button></div>`)
  .replace('<script src="i18n.js"></script>', () => '')
  .replace('<script src="app.js"></script>', () => `<script>\n${safe(read('standalone/mock-api.js'))}\n</script>\n  <script>\n${safe(read('public/i18n.js'))}\n</script>\n  <script>\n${safe(app)}\n</script>`);

const out = path.join(__dirname, 'maa-demo.html');
fs.writeFileSync(out, html);
console.log(`Wrote ${path.relative(root, out)} (${(html.length / 1024).toFixed(0)} KB)`);

// Optional second output: the same page as a body fragment (no <html>/<head>/<body>),
// for hosts that wrap the page in their own document skeleton.
if (process.argv[2]) {
  const head = html.match(/<head>([\s\S]*?)<\/head>/)[1]
    .replace(/<meta charset[^>]*>\s*/, '')
    .replace(/<meta name="viewport"[^>]*>\s*/, '<meta name="claude:viewport-fit-sides" content="cover">\n  ');
  const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
  fs.writeFileSync(process.argv[2], `${head.trim()}\n${body.trim()}\n`);
  console.log(`Wrote fragment ${process.argv[2]}`);
}
