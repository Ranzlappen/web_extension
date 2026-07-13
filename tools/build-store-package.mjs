// Derives the Chrome Web Store package from the source extension.
//
// The store build differs from the self-hosted build in two ways:
//   1. The Capture (screenshot) and Media (video download) features are
//      removed — every UI block and JS region fenced by the
//      __PS_STORE_STRIP_START__ / __PS_STORE_STRIP_END__ markers is dropped,
//      and background.js (whose only job is the "Download this video"
//      context-menu entry) is excluded entirely.
//   2. The manifest is trimmed for Chrome: the now-unused `downloads` and
//      `contextMenus` permissions are removed, along with the `background`
//      worker and the Opera/Firefox-only keys (`sidebar_action`,
//      `browser_specific_settings`) that only cause upload warnings.
//
// The source tree in domain-css-injector-v2/ stays the single source of
// truth — never hand-maintain a store variant.
//
// Usage: node tools/build-store-package.mjs [outDir]   (default: dist/store-pkg)
import { cpSync, rmSync, readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'domain-css-injector-v2');
const OUT = resolve(process.argv[2] || join(ROOT, 'dist', 'store-pkg'));

const STRIPPED_PERMISSIONS = ['downloads', 'contextMenus'];
const STRIPPED_MANIFEST_KEYS = ['background', 'sidebar_action', 'browser_specific_settings'];
const EXCLUDED_FILES = ['background.js'];

function stripRegions(text, markerPairs, file) {
  let stripped = text;
  let count = 0;
  for (const [startMark, endMark] of markerPairs) {
    const pattern = new RegExp(
      `[ \\t]*${startMark}[\\s\\S]*?${endMark}[ \\t]*\\r?\\n?`, 'g'
    );
    count += (stripped.match(pattern) || []).length;
    stripped = stripped.replace(pattern, '');
  }
  if (!count) throw new Error(`${file}: no strip regions found — markers missing?`);
  if (/__PS_STORE_STRIP_(START|END)__/.test(stripped)) {
    throw new Error(`${file}: unbalanced strip marker remains after strip`);
  }
  return stripped;
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
for (const entry of readdirSync(SRC)) {
  if (EXCLUDED_FILES.includes(entry)) continue;
  cpSync(join(SRC, entry), join(OUT, entry), { recursive: true });
}

// Strip the fenced Capture/Media regions out of the popup sources. popup.html
// carries two marker styles: HTML comments in markup and CSS comments inside
// its <style> block.
const JS_PAIR = ['/\\* __PS_STORE_STRIP_START__', '__PS_STORE_STRIP_END__ \\*/'];
const HTML_PAIR = ['<!-- __PS_STORE_STRIP_START__', '__PS_STORE_STRIP_END__ -->'];
writeFileSync(join(OUT, 'popup.js'),
  stripRegions(readFileSync(join(SRC, 'popup.js'), 'utf8'), [JS_PAIR], 'popup.js'));
writeFileSync(join(OUT, 'popup.html'),
  stripRegions(readFileSync(join(SRC, 'popup.html'), 'utf8'), [HTML_PAIR, JS_PAIR], 'popup.html'));

// Trim the manifest. The description is overridden because the source one
// mentions the media saver, which the store build does not ship.
const STORE_DESCRIPTION = 'Per-site custom CSS with live preview, element picker and hider, text-to-speech reader, site notes, and a tab organizer.';
const manifest = JSON.parse(readFileSync(join(SRC, 'manifest.json'), 'utf8'));
manifest.description = STORE_DESCRIPTION;
manifest.permissions = (manifest.permissions || []).filter((p) => !STRIPPED_PERMISSIONS.includes(p));
for (const key of STRIPPED_MANIFEST_KEYS) delete manifest[key];
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

// The stripped popup.js must still parse, and no stripped symbol may remain
// referenced anywhere in the package.
const check = spawnSync('node', ['--check', join(OUT, 'popup.js')], { encoding: 'utf8' });
if (check.status !== 0) {
  throw new Error(`stripped popup.js failed node --check:\n${check.stderr}`);
}
const leftovers = /captureScreenshot|pickAndSaveMedia|collectMediaSources|downloadVideoBtn|screenshotBtn|mediaList|chrome\.downloads|chrome\.contextMenus/;
for (const file of ['popup.js', 'popup.html']) {
  const body = readFileSync(join(OUT, file), 'utf8');
  const hit = body.match(leftovers);
  if (hit) throw new Error(`${file}: stripped build still references "${hit[0]}"`);
}

console.log(`Store package written to ${OUT} (version ${manifest.version}, ` +
  `permissions: ${manifest.permissions.join(', ')})`);
