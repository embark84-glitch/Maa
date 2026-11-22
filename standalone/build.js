'use strict';
/*
 * Build the standalone demo: the whole app in one HTML file that needs no server.
 * The real server modules (src/) are bundled with a tiny CommonJS loader and run
 * in the browser on sql.js (standalone/demo-server.js), so the demo behaves
 * exactly like the Node server.
 *
 *   node standalone/build.js [fragment-output.html]
 *
 * Writes standalone/maa-demo.html (a full page). With an argument, also writes the
 * same page as a body fragment for hosts that add their own <html>/<head>/<body>.
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const safe = (js) => js.replace(/<\/script/gi, '<\\/script');

// Library versions loaded from jsDelivr (pinned; served by the artifact host's allowed CDN).
const SQLJS = 'https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/sql-asm.js';

// Modules that run in the browser, and Node-only modules swapped for browser versions.
const MODULES = [
  'standalone/demo-server', 'standalone/auth-browser',
  'src/http', 'src/store', 'src/validate', 'src/policy', 'src/seed',
  'src/routes/index', 'src/routes/auth', 'src/routes/catalog', 'src/routes/supplier',
  'src/routes/orders', 'src/routes/deliveries', 'src/routes/admin',
  'shared/payment', 'shared/import', 'shared/recognize',
];
const SWAP = { 'src/auth': 'standalone/auth-browser' };

function bundle() {
  const defs = MODULES.map((id) => `${JSON.stringify(id)}: function (module, exports, require) {\n${read(`${id}.js`)}\n}`);
  return `(function () {
  'use strict';
  var defs = {${defs.join(',\n')}};
  var swap = ${JSON.stringify(SWAP)};
  var cache = {};
  function resolve(from, spec) {
    var parts = from.split('/'); parts.pop();
    spec.replace(/\\.js$/, '').split('/').forEach(function (p) {
      if (p === '..') parts.pop(); else if (p !== '.') parts.push(p);
    });
    var id = parts.join('/');
    if (swap[id]) id = swap[id];
    if (!defs[id] && defs[id + '/index']) id = id + '/index';
    return id;
  }
  function load(id) {
    if (cache[id]) return cache[id].exports;
    if (!defs[id]) throw new Error('Module not bundled: ' + id);
    var module = cache[id] = { exports: {} };
    defs[id](module, module.exports, function (spec) { return load(resolve(id, spec)); });
    return module.exports;
  }
  load('standalone/demo-server');
})();`;
}

const css = read('public/styles.css');
let html = read('public/index.html')
  .replace('<link rel="stylesheet" href="styles.css">', () => `<style>\n${css}\n</style>`)
  .replace('<script src="shared/payment.js"></script>', () => '')
  .replace('<script src="shared/import.js"></script>', () => '')
  .replace('<script src="i18n.js"></script>', () => `<script src="${SQLJS}"></script>\n  <script>\n${safe(bundle())}\n</script>\n  <script>\n${safe(read('public/i18n.js'))}\n</script>`)
  .replace('<script src="app.js"></script>', () => `<script>\n${safe(read('public/app.js'))}\n</script>`);

for (const leftover of ['src="shared/', 'src="i18n.js"', 'src="app.js"', 'href="styles.css"']) {
  if (html.includes(leftover)) throw new Error(`build: ${leftover} was not inlined; public/index.html changed?`);
}

const out = path.join(__dirname, 'maa-demo.html');
fs.writeFileSync(out, html);
// Pack photos sit next to the page (img/products/...), as on the real server.
const imgSrc = path.join(root, 'public', 'img');
fs.cpSync(imgSrc, path.join(__dirname, 'img'), { recursive: true });
console.log(`Wrote ${path.relative(root, out)} (${(html.length / 1024).toFixed(0)} KB)`);

if (process.argv[2]) {
  const head = html.match(/<head>([\s\S]*?)<\/head>/)[1]
    .replace(/<meta charset[^>]*>\s*/, '')
    .replace(/<meta name="viewport"[^>]*>\s*/, '<meta name="claude:viewport-fit-sides" content="cover">\n  ');
  const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
  // Title first, so hosts that scan the start of the file find it.
  const title = head.match(/<title>[^<]*<\/title>/)[0];
  fs.writeFileSync(process.argv[2], `${title}\n${head.replace(title, '').trim()}\n${body.trim()}\n`);
  console.log(`Wrote fragment ${process.argv[2]}`);
}
