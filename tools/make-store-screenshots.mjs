// Generates the 1280x800 Chrome Web Store screenshots in store/screenshots/.
//
// Loads the extension into a real (headless) Chromium via Playwright, opens
// popup.html with seeded demo storage, captures each section at popup width,
// then composes every capture onto a branded 1280x800 canvas.
//
// Run from the repo root (needs a playwright package — local or global):
//   node tools/make-store-screenshots.mjs
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import os from 'node:os';

// Resolve playwright from the local project if present, else the global root.
const req = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = req('playwright'));
} catch {
  const globalRoot = execSync('npm root -g').toString().trim();
  ({ chromium } = req(join(globalRoot, 'playwright')));
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXT = resolve(ROOT, 'domain-css-injector-v2');
const OUT = resolve(ROOT, 'store', 'screenshots');
mkdirSync(OUT, { recursive: true });

const DEMO_CSS = `/* example.com — my theme */
body {
  background: #0f121c;
  color: #e6e8ef;
}
a { color: #4aa3ff; }

/* declutter */
.cookie-banner,
.newsletter-modal { display: none !important; }`;

const SEED = {
  'example.com': DEMO_CSS,
  'wikipedia.org': 'body { font-size: 18px; }\n#siteNotice { display: none; }',
  'github.com': '.js-header { position: static !important; }',
  '__ps_lasthost': 'example.com',
  '__ps_notes': { 'example.com': 'Login uses the work account.\nDark theme saved 2026-07-12.' }
};

const SHOTS = [
  {
    file: '01-style-editor.png',
    open: ['Style'],
    headline: 'Restyle any website with your own CSS',
    sub: 'Per-site snippets with live preview, quick presets, and a one-tap element hider — reapplied automatically on every visit.'
  },
  {
    file: '02-tools.png',
    open: ['Tools'],
    headline: 'Read aloud, capture, and save media',
    sub: 'Text-to-speech for any page, one-tap screenshots, page media downloads, and JSON backup of all your snippets.'
  },
  {
    file: '03-password.png',
    open: ['Password'],
    headline: 'A password generator that stores nothing',
    sub: 'Cryptographic RNG, passphrase mode, and a live strength meter. Generated secrets never touch the disk.'
  },
  {
    file: '04-notes-tabs.png',
    open: ['Notes', 'Tabs'],
    headline: 'Private site notes & a tab organizer',
    sub: 'Per-site notes that stay on your device, plus sort, group-by-domain, and close-duplicates for every open tab.'
  }
];

const userDataDir = resolve(os.tmpdir(), `pageside-shots-${process.pid}`);
const context = await chromium.launchPersistentContext(userDataDir, {
  channel: 'chromium',
  headless: true,
  viewport: { width: 420, height: 760 },
  deviceScaleFactor: 2,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
});

try {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const extId = new URL(worker.url()).host;

  // A few real tabs so the Tabs organizer list has content.
  for (const url of ['https://example.com/', 'https://www.wikipedia.org/', 'https://github.com/']) {
    try {
      const p = await context.newPage();
      await p.goto(url, { timeout: 15000, waitUntil: 'domcontentloaded' });
    } catch { /* offline is fine — the list just stays shorter */ }
  }

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await popup.evaluate((seed) => chrome.storage.local.set(seed), SEED);
  await popup.reload();
  await popup.waitForTimeout(1200);

  for (const shot of SHOTS) {
    await popup.evaluate(({ open, css }) => {
      document.getElementById('domainInfo').textContent = 'Detected site: example.com';
      document.getElementById('domainInfo').style.cursor = '';
      document.getElementById('status').textContent = '';
      for (const d of document.querySelectorAll('details.sec')) {
        const label = d.querySelector('summary').textContent.trim().split(/\s/)[0];
        d.open = open.includes(label);
      }
      if (open.includes('Style')) {
        const ta = document.getElementById('cssInput');
        ta.value = css;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (open.includes('Password')) document.getElementById('pwGen').click();
      if (open.includes('Tools')) document.getElementById('refreshBtn').click();
      window.scrollTo(0, 0);
    }, { open: shot.open, css: DEMO_CSS });
    await popup.waitForTimeout(500);
    // Second pass: async host re-detection / draft restore may have replaced
    // the staged label or status after the first evaluate — re-stage and shoot
    // immediately.
    await popup.evaluate((open) => {
      document.getElementById('domainInfo').textContent = 'Detected site: example.com';
      document.getElementById('status').textContent = '';
      if (open.includes('Notes')) {
        document.getElementById('notesDomain').textContent = 'example.com';
        document.getElementById('noteInput').value =
          'Login uses the work account.\nDark theme saved 2026-07-12.';
      }
      window.scrollTo(0, 0);
    }, shot.open);
    const raw = await popup.screenshot({ clip: { x: 0, y: 0, width: 420, height: 760 } });

    // Compose the popup capture onto the 1280x800 store canvas.
    const canvas = await context.newPage();
    await canvas.setViewportSize({ width: 1280, height: 800 });
    await canvas.setContent(`<!doctype html><html><head><style>
      * { margin: 0; box-sizing: border-box; }
      body { width: 1280px; height: 800px; overflow: hidden;
        font-family: -apple-system, "Segoe UI", Roboto, Ubuntu, sans-serif;
        background: radial-gradient(1200px 800px at 85% 20%, #1d2440 0%, #0f121c 55%, #0a0d14 100%);
        color: #e6e8ef; display: flex; align-items: center; }
      .text { flex: 1 1 auto; padding: 0 48px 0 72px; }
      .brand { display: flex; align-items: center; gap: 14px; margin-bottom: 34px; }
      .brand img { width: 48px; height: 48px; border-radius: 10px; }
      .brand span { font-size: 26px; font-weight: 700; letter-spacing: .5px; }
      h1 { font-size: 44px; line-height: 1.15; margin-bottom: 22px; font-weight: 800; }
      p { font-size: 21px; line-height: 1.5; color: #aab3c5; max-width: 560px; }
      .badge { display: inline-block; margin-top: 30px; padding: 8px 16px; border: 1px solid #2a2f44;
        border-radius: 999px; color: #7fb7ff; font-size: 15px; background: #11151f; }
      .shotwrap { flex: 0 0 auto; padding-right: 64px; }
      .shot { width: 400px; border-radius: 14px; border: 1px solid #2a2f44;
        box-shadow: 0 30px 80px rgba(0,0,0,.65); display: block; }
    </style></head><body>
      <div class="text">
        <div class="brand"><img src="data:image/png;base64,${readFileSync(resolve(EXT, 'icons', 'icon128.png')).toString('base64')}"><span>Pageside</span></div>
        <h1>${shot.headline}</h1>
        <p>${shot.sub}</p>
        <div class="badge">100% local — no account, no server, no tracking</div>
      </div>
      <div class="shotwrap"><img class="shot" src="data:image/png;base64,${raw.toString('base64')}"></div>
    </body></html>`);
    await canvas.waitForTimeout(250);
    // scale: 'css' pins the output to CSS pixels — exactly 1280x800 as the
    // Web Store requires — regardless of the context's deviceScaleFactor.
    const png = await canvas.screenshot({ clip: { x: 0, y: 0, width: 1280, height: 800 }, scale: 'css' });
    writeFileSync(resolve(OUT, shot.file), png);
    await canvas.close();
    console.log(`wrote store/screenshots/${shot.file}`);
  }
} finally {
  await context.close();
  rmSync(userDataDir, { recursive: true, force: true });
}
