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
import crypto from 'node:crypto';
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
const OUT = resolve(ROOT, 'store', 'screenshots');
mkdirSync(OUT, { recursive: true });

// Screenshot the STORE build (Capture/Media stripped), not the full source —
// the store listing must show exactly what the reviewer installs.
const EXT = resolve(os.tmpdir(), `pageside-store-pkg-${process.pid}`);
execSync(`node ${JSON.stringify(resolve(ROOT, 'tools', 'build-store-package.mjs'))} ${JSON.stringify(EXT)}`, { stdio: 'inherit' });

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
    headline: 'Have any page read aloud',
    sub: 'Text-to-speech for the selected text or the whole page, with adjustable speed — plus one-click JSON backup and restore of all your site styles.'
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
  // The store build has no background worker to discover the ID from, but an
  // unpacked extension's ID is deterministic: SHA-256 of its absolute path,
  // first 16 bytes, hex digits mapped to a-p.
  const extId = crypto.createHash('sha256').update(EXT).digest('hex')
    .slice(0, 32).replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));

  // A few real tabs so the Tabs organizer list has content.
  for (const url of ['https://example.com/', 'https://www.wikipedia.org/', 'https://github.com/']) {
    try {
      const p = await context.newPage();
      await p.goto(url, { timeout: 15000, waitUntil: 'domcontentloaded' });
    } catch { /* offline is fine — the list just stays shorter */ }
  }

  const popup = await context.newPage();
  const resp = await popup.goto(`chrome-extension://${extId}/popup.html`);
  if (!resp || !resp.ok()) throw new Error(`popup.html did not load — computed extension id ${extId} wrong?`);
  await popup.evaluate((seed) => chrome.storage.local.set(seed), SEED);
  await popup.reload();
  await popup.waitForTimeout(1200);

  const raws = {};
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
    raws[shot.file] = raw;

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
      /* The icon PNG has a solid dark square background (no alpha), so frame
         it as a deliberate rounded app-icon tile instead of a bare image. */
      .brand img { width: 56px; height: 56px; border-radius: 14px;
        border: 1px solid #2f3854; box-shadow: 0 6px 18px rgba(0,0,0,.5), 0 0 22px rgba(74,163,255,.18); }
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
  // Optional store promo images: small tile (440x280) and marquee (1400x560).
  const iconB64 = readFileSync(resolve(EXT, 'icons', 'icon128.png')).toString('base64');
  const promoCss = `
    * { margin: 0; box-sizing: border-box; }
    body { overflow: hidden; font-family: -apple-system, "Segoe UI", Roboto, Ubuntu, sans-serif;
      background: radial-gradient(900px 600px at 80% 15%, #1d2440 0%, #0f121c 55%, #0a0d14 100%);
      color: #e6e8ef; display: flex; align-items: center; }
    img.icon { border-radius: 14px; border: 1px solid #2f3854;
      box-shadow: 0 6px 18px rgba(0,0,0,.5), 0 0 22px rgba(74,163,255,.18); }
    .badge { display: inline-block; padding: 6px 14px; border: 1px solid #2a2f44;
      border-radius: 999px; color: #7fb7ff; background: #11151f; }`;
  const promos = [
    {
      file: 'promo-small-440x280.png', width: 440, height: 280,
      html: `<style>${promoCss}
        body { justify-content: center; text-align: center; }
        .wrap { padding: 0 24px; }
        img.icon { width: 72px; height: 72px; margin-bottom: 14px; }
        h1 { font-size: 34px; font-weight: 800; margin-bottom: 8px; }
        p { font-size: 16px; color: #aab3c5; }
      </style><div class="wrap">
        <img class="icon" src="data:image/png;base64,${iconB64}">
        <h1>Pageside</h1>
        <p>Your own CSS, on every site you visit</p>
      </div>`
    },
    {
      file: 'promo-marquee-1400x560.png', width: 1400, height: 560,
      html: `<style>${promoCss}
        .text { flex: 1 1 auto; padding: 0 40px 0 72px; }
        .brand { display: flex; align-items: center; gap: 14px; margin-bottom: 26px; }
        img.icon { width: 56px; height: 56px; }
        .brand span { font-size: 26px; font-weight: 700; }
        h1 { font-size: 48px; line-height: 1.12; font-weight: 800; margin-bottom: 18px; max-width: 640px; }
        p { font-size: 21px; line-height: 1.45; color: #aab3c5; max-width: 560px; margin-bottom: 26px; }
        .shotwrap { flex: 0 0 auto; padding-right: 72px; align-self: flex-start; margin-top: 48px; }
        .shot { width: 330px; display: block; border-radius: 14px; border: 1px solid #2a2f44;
          box-shadow: 0 30px 80px rgba(0,0,0,.65); }
      </style>
      <div class="text">
        <div class="brand"><img class="icon" src="data:image/png;base64,${iconB64}"><span>Pageside</span></div>
        <h1>Make any site look the way you want</h1>
        <p>Per-site custom CSS with live preview, an element picker &amp; hider, read-aloud, private site notes, and a tab organizer.</p>
        <div class="badge">100% local — no account, no server, no tracking</div>
      </div>
      <div class="shotwrap"><img class="shot" src="data:image/png;base64,${raws['01-style-editor.png'].toString('base64')}"></div>`
    }
  ];
  for (const promo of promos) {
    const pg = await context.newPage();
    await pg.setViewportSize({ width: promo.width, height: promo.height });
    await pg.setContent(`<!doctype html><html><head></head><body style="width:${promo.width}px;height:${promo.height}px">${promo.html}</body></html>`);
    await pg.waitForTimeout(250);
    const png = await pg.screenshot({ clip: { x: 0, y: 0, width: promo.width, height: promo.height }, scale: 'css' });
    writeFileSync(resolve(OUT, promo.file), png);
    await pg.close();
    console.log(`wrote store/screenshots/${promo.file}`);
  }
} finally {
  await context.close();
  rmSync(userDataDir, { recursive: true, force: true });
  rmSync(EXT, { recursive: true, force: true });
}
