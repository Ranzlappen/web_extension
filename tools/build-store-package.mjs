// Derives the Chrome Web Store package from the source extension.
//
// The store build differs from the self-hosted build in two ways:
//   1. The Capture (screenshot) and Media (video download) features are
//      removed — every UI block and JS region fenced by the
//      __PS_STORE_STRIP_START__ / __PS_STORE_STRIP_END__ markers is dropped,
//      including the context-menu half of background.js. The worker itself
//      still ships: it also routes the page hotkeys (tab mute / volume), which
//      a content script cannot do on its own.
//   2. The manifest is trimmed for Chrome: the now-unused `downloads` and
//      `contextMenus` permissions are removed, along with the Opera/Firefox
//      only keys (`sidebar_action`, `browser_specific_settings`) and the
//      Firefox event-page fallback (`background.scripts`), which only cause
//      upload warnings.
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
const STRIPPED_MANIFEST_KEYS = ['sidebar_action', 'browser_specific_settings'];
// Sources carrying fenced Capture/Media regions, stripped in place below.
const JS_STRIPPED_FILES = ['popup.js', 'background.js'];

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
  cpSync(join(SRC, entry), join(OUT, entry), { recursive: true });
}

// Strip the fenced Capture/Media regions out of the popup and worker sources.
// popup.html carries two marker styles: HTML comments in markup and CSS
// comments inside its <style> block.
const JS_PAIR = ['/\\* __PS_STORE_STRIP_START__', '__PS_STORE_STRIP_END__ \\*/'];
const HTML_PAIR = ['<!-- __PS_STORE_STRIP_START__', '__PS_STORE_STRIP_END__ -->'];
for (const file of JS_STRIPPED_FILES) {
  writeFileSync(join(OUT, file),
    stripRegions(readFileSync(join(SRC, file), 'utf8'), [JS_PAIR], file));
}
writeFileSync(join(OUT, 'popup.html'),
  stripRegions(readFileSync(join(SRC, 'popup.html'), 'utf8'), [HTML_PAIR, JS_PAIR], 'popup.html'));

// Trim the manifest. The description is overridden because the source one
// mentions the media saver, which the store build does not ship.
const STORE_DESCRIPTION = 'Per-site custom CSS with live preview, element picker and hider, text-to-speech, site notes, page hotkeys, and a tab organizer.';
const manifest = JSON.parse(readFileSync(join(SRC, 'manifest.json'), 'utf8'));
manifest.description = STORE_DESCRIPTION;
manifest.permissions = (manifest.permissions || []).filter((p) => !STRIPPED_PERMISSIONS.includes(p));
for (const key of STRIPPED_MANIFEST_KEYS) delete manifest[key];
// The service worker stays (it routes the hotkey tab actions); only the
// Firefox-only event-page fallback is dropped, which Chrome warns about.
if (manifest.background) delete manifest.background.scripts;
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

// Every stripped source must still parse, and no stripped symbol may remain
// referenced anywhere in the package.
for (const file of JS_STRIPPED_FILES) {
  const check = spawnSync('node', ['--check', join(OUT, file)], { encoding: 'utf8' });
  if (check.status !== 0) {
    throw new Error(`stripped ${file} failed node --check:\n${check.stderr}`);
  }
}
const leftovers = /captureScreenshot|pickAndSaveMedia|collectMediaSources|downloadVideoBtn|screenshotBtn|mediaList|ensureMenu|PS_DL_VIDEO_MENU_ID|chrome\.downloads|chrome\.contextMenus/;
for (const file of [...JS_STRIPPED_FILES, 'popup.html']) {
  const body = readFileSync(join(OUT, file), 'utf8');
  const hit = body.match(leftovers);
  if (hit) throw new Error(`${file}: stripped build still references "${hit[0]}"`);
}

console.log(`Store package written to ${OUT} (version ${manifest.version}, ` +
  `permissions: ${manifest.permissions.join(', ')})`);
