'use strict';
/* Bundle the web client + in-browser demo backend into one self-contained HTML file. */
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const safe = (js) => js.replace(/<\/script/gi, '<\\/script');

const css = read('public/styles.css') + `
.demo-bar { background: var(--brand-soft); color: var(--text); font-size: .85rem; padding: .45rem 16px;
  display: flex; gap: .75rem; align-items: center; justify-content: center; flex-wrap: wrap; text-align: center; }
.demo-bar button { font-size: .8rem; padding: .2rem .6rem; }`;

const app = read('public/app.js')
  .replace('Run <code>npm run seed</code> first. Password: <code>password123</code>', 'Password: <code>password123</code>');

let html = read('public/index.html')
  .replace('<title>Maa · Pharmacy Supply</title>', '<title>Maa Pharmacy Supply</title>')
  .replace('<link rel="stylesheet" href="styles.css">', () => `<style>\n${css}\n</style>`)
  .replace('<body>', () => `<body>
  <div class="demo-bar">Demo version: runs entirely in your browser, data stays on this device.
    <button type="button" onclick="maaResetDemo()">Reset demo data</button></div>`)
  .replace('<script src="app.js"></script>', () => `<script>\n${safe(read('standalone/mock-api.js'))}\n</script>\n  <script>\n${safe(app)}\n</script>`);

const out = path.join(__dirname, 'maa-demo.html');
fs.writeFileSync(out, html);
console.log(`Wrote ${path.relative(root, out)} (${(html.length / 1024).toFixed(0)} KB)`);
