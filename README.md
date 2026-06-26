# Opera

**Pageside** — per-domain CSS injection, container inspection, TTS reading, and video-media downloads — packaged as a single Manifest V3 browser extension that works in Chromium browsers (Opera, Chrome, Edge) and Firefox.

> **New here?** If you just want to install and use the extension, jump to [Getting Started](#getting-started). If you're a developer or want to understand the architecture, see [`CLAUDE.md`](./CLAUDE.md).

---

## What this is

A lightweight browser extension that lets you author and persist a CSS snippet per domain. Open the popup (Chrome/Edge) or the sidebar panel (Opera/Firefox), type CSS, and it is injected into every page on that domain on every visit. The popup also exposes a quick element inspector that copies a CSS selector to the clipboard, a Web-Speech TTS reader for selected text, a media-URL extractor that can download `<video>` sources straight from the active tab, a right-click **Download this video** entry on any video element on the page, a **per-domain notepad** for private site notes, and a **cryptographic password / passphrase generator**.

The UI is organized into collapsible sections (Style / Notes / Password / Tools) tuned for mobile viewports — large tap targets, safe-area padding, and no horizontal overflow on a phone like Kiwi.

Everything is stored locally via `chrome.storage.local` — there is no server, no account, and no telemetry. Generated passwords are never stored.

---

## Quick Reference

The most common tasks. For anything not listed, see [Developer Setup](#developer-setup) or [`CLAUDE.md`](./CLAUDE.md).

| I want to... | Do this |
| --- | --- |
| Install the extension | Open `chrome://extensions` (or `opera://extensions`), enable **Developer mode**, click **Load unpacked**, and select the `domain-css-injector-v2/` folder. |
| Open the editor on Chrome / Edge | Click the **Pageside** toolbar icon — the popup opens. |
| Open the editor on Opera / Firefox | Open the browser **sidebar** and pick **Pageside**. |
| Add CSS for a site | Visit the site, open the editor, type CSS, click **Save Style Changes**. |
| Remove CSS for a site | Visit the site, open the editor, click **Delete Style for this Page**. |
| Copy a selector from the page | Click **Select Container**, hover over the element, click it. The selector is copied to the clipboard. |
| Read selected text aloud | Select text on the page, open the editor, click **Read Selected Text**. |
| Download a `<video>` from a page | Either right-click the video on the page and choose **Download this video**, or open the editor and click **Download Video Media**. |
| Keep a private note for a site | Open the **Notes** section, type — it auto-saves per domain (or tap **Save note**). |
| Generate a strong password | Open the **Password** section, set the options, tap **Generate**, then **Copy**. |
| Back up all snippets | Open the editor, click **Export JSON**. (Private notes are never included in the export.) |
| Restore a snippet on another browser | Open the editor on the target site, paste the JSON value into the editor, **Save**. |

---

## Getting Started

The extension is distributed as an unpacked folder. Install steps are the same on Windows, macOS, and Linux Chromium browsers.

1. Download or clone this repo to your machine.
2. Open `chrome://extensions` (Chrome / Edge) or `opera://extensions` (Opera).
3. Toggle **Developer mode** on (top-right).
4. Click **Load unpacked** and select the `domain-css-injector-v2/` folder inside this repo.
5. Pin the **Pageside** icon to the toolbar so the popup is one click away.

For phone browsers see [Mobile installation](#mobile-installation).

---

## Mobile installation

Pageside is a standard Chromium / WebExtensions add-on, so any phone browser that supports loading unpacked or `.crx` extensions can run it. Stock Chrome on Android does **not** support extensions — pick one of the browsers below instead.

### Build a `.zip` of the extension first

Phone browsers install from a single archive, not a folder. Either:

* Download the latest `pageside-<version>.zip` from this repo's [Releases](../../releases) page (every tagged release attaches one), **or**
* Build it yourself: zip the contents of `domain-css-injector-v2/` (not the folder itself — the `manifest.json` must sit at the root of the archive). On a phone you can do this with any file-manager app that has a "compress" action; on a desktop, run `cd domain-css-injector-v2 && zip -r ../pageside.zip .`.

Transfer the `.zip` to your phone (USB, Google Drive, email to yourself, etc.) and remember its path — you'll need it for every step below.

### Kiwi Browser (Chromium, Android — recommended)

Kiwi is the most popular Chromium fork on Android with full extension support. It loads unpacked Manifest V2 and V3 extensions directly from a `.zip`.

1. Install **Kiwi Browser** from the Play Store.
2. Open Kiwi → tap the **⋮** menu → **Extensions**.
3. Toggle **Developer mode** on (top-right of the Extensions page).
4. Tap **+ (from .zip / .crx / .user.js)** and pick the `pageside-<version>.zip` you saved.
5. Confirm the permissions prompt. The extension will appear in the list.
6. Tap **⋮** → **Pageside** any time to open the popup. The toolbar / sidebar surface depends on the Kiwi build; the popup works the same as on desktop.

### Yandex Browser (Android)

Yandex Browser supports a curated set of Chrome Web Store extensions and can sideload `.crx` files.

1. Install **Yandex Browser** from the Play Store.
2. Open Yandex → tap **⋮** → **Settings** → **Catalog of Yandex.Browser add-ons** to enable the extension subsystem at least once.
3. Open the `.zip` you built and rename it to `pageside-<version>.crx` (Yandex requires the `.crx` extension, but the contents are the same zip layout).
4. Open the file in Yandex Browser via your file manager → confirm the install prompt.
5. Manage from **⋮** → **Add-ons**.

### Mises Browser / Lemur Browser (Android)

Both are Chromium forks that mirror Kiwi's extension flow. The steps are identical to Kiwi — `⋮` → **Extensions** → enable **Developer mode** → install from the `.zip`.

### Firefox for Android (geckoview-based)

Firefox for Android only loads extensions from a signed Mozilla collection. To run Pageside there:

1. Sign in to a Firefox Account in **Firefox Nightly** for Android.
2. On desktop, sign in to the same account at <https://addons.mozilla.org/en-US/firefox/collections/> and create a private collection containing your self-hosted build (you must submit `pageside-<version>.zip` to AMO as an unlisted add-on first to get a signed `.xpi`).
3. In Firefox Nightly: `⋮` → **Settings** → **About Firefox Nightly** → tap the logo 5× to unlock the **Custom Add-on collection** debug menu.
4. Enter your Firefox Account user-id and the collection name.
5. Restart the browser. Pageside will be installable from the **Add-ons** menu.

This is more involved than the Chromium fork flow because Firefox enforces signing on Android.

### Edge / Opera / Brave on Android

These ship without extension support on Android (as of writing). Use Kiwi or Mises if you're on a phone; Edge / Opera / Brave on desktop work normally — see [Getting Started](#getting-started).

### Verifying the install on mobile

Once installed:

1. Visit any HTTPS site.
2. Open the Pageside popup. The detected site label should match the page's base domain.
3. Try **Save Style Changes** with a tiny rule like `body { background: #102030; }` to confirm CSS is being injected on mobile.
4. Tap **Select Container**, then drag a finger over the page to preview the highlight and lift / tap to copy the element's selector — the picker is touch-driven, so no mouse is needed.
5. Tap **Download Video Media** to scan the page; found sources appear as an in-popup list — tap one to download. (The right-click "Download this video" context-menu entry is desktop-only; long-press support varies by mobile build, so the in-popup list is the reliable mobile path.)

If the toolbar entry never appears after install, double-check that the `manifest.json` is at the **root** of your zip (not inside a `domain-css-injector-v2/` sub-folder).

---

## Developer Setup

### Prerequisites

* A Chromium browser (Chrome 116+, Edge 116+, Opera 102+) or Firefox 121+ — required to load the unpacked extension.
* Optional: Node 20+ — only needed if you want to run the lint workflow locally.

### Install and run

```
git clone https://github.com/Ranzlappen/opera.git
cd opera
# Then load domain-css-injector-v2/ as an unpacked extension (see Getting Started).
```

There is no build step. Edit a file, then click **Reload** on the extension card in `chrome://extensions` to pick up the change.

### Modules

| Module | Path | Role | Local dev |
| --- | --- | --- | --- |
| CSS Injector | `domain-css-injector-v2/` | The extension itself — popup UI, content script, manifest, icons. | Load unpacked, edit, reload. |

### Architecture source of truth

[`CLAUDE.md`](./CLAUDE.md) is the authoritative architecture doc (entry points, storage shape, conventions, browser-compatibility matrix). When this README and `CLAUDE.md` disagree, `CLAUDE.md` wins and this README needs updating.

### CI/CD at a glance

| Workflow | Trigger | What it does |
| --- | --- | --- |
| [`ci.yml`](./.github/workflows/ci.yml) | PR / push touching `domain-css-injector-v2/**` | Validates `manifest.json`, syntax-checks the JS files, and confirms required icon assets exist. |
| [`release.yml`](./.github/workflows/release.yml) | tag push `v*` or manual dispatch | Validates, zips `domain-css-injector-v2/` into `pageside-<version>.zip`, uploads it as a workflow artifact, and (on tag pushes) attaches it to a GitHub Release. |

---

## How to add CSS for a domain

1. Visit the site you want to style (e.g. `https://example.com`).
2. Open the editor (toolbar icon on Chrome / Edge, sidebar on Opera / Firefox).
3. The popup detects the **base domain** (e.g. `example.com` for `www.example.com`) and shows it under "Detected site".
4. Type or paste your CSS:
   ```css
   body { background: #0f121c; color: #e6e8ef; }
   a    { color: #4aa3ff; }
   ```
5. Click **Save Style Changes**. The page reflects the change immediately and on every future visit.

Saved snippets appear in the **Saved snippets** list at the bottom of the popup. Click any entry to load it back into the editor.

---

## How to download a video from a page

There are two ways to grab a video, both of which use the same `chrome.downloads` pipeline (`conflictAction: 'uniquify'`, blob streams skipped — they cannot be downloaded directly):

**A. Right-click the video on the page**

1. Right-click (or long-press on touch / mobile) any visible `<video>` element.
2. Pick **Download this video** from the native context menu.
3. The browser's download manager takes over.

This is the fastest path when you can see the video you want. It uses the `contextMenus` integration registered by the extension's background service worker.

**B. Pick from a list of every detected source**

1. Open the page that has a `<video>` element.
2. Open the editor and click **Download Video Media**.
3. The popup scans every frame for `video.currentSrc`, `<source>` tags, media-typed `<a href>` links, network resource entries, and (on YouTube) `ytInitialPlayerResponse`.
4. Found sources appear as an in-popup tappable list, ranked by likelihood of being a real downloadable file. Tap one to download it. (Blob streams are shown disabled — they cannot be fetched directly.)

Use B when the video tag is hidden, lazy-loaded, or you need an alternate quality / source URL.

---

## Per-domain notes

The **Notes** section keeps a private, free-form note bound to the current site's base domain, stored locally in `chrome.storage.local` under the reserved `__ps_notes` key.

1. Open the editor and expand **Notes**.
2. Type anything — it **auto-saves** ~0.6s after you stop typing (or tap **Save note** to persist immediately).
3. Switch to a page on a different domain and the note reloads for that domain automatically.
4. A small dot next to the **Notes** heading indicates the current domain has a saved note. **Clear note** empties it (and removes the entry from storage).

Notes are deliberately **excluded** from **Export JSON**, so a shared snippet backup never leaks your private notes.

---

## Password generator

The **Password** section generates strong secrets using the browser's cryptographic RNG (`crypto.getRandomValues` with unbiased rejection sampling — never `Math.random`). Nothing generated is ever stored; copy it before closing the popup.

* **Length** slider, and toggles for **lowercase / uppercase / digits / symbols**.
* **Exclude ambiguous** strips easily-confused characters (`0 O 1 l I`).
* **Require each selected set** guarantees at least one character from every enabled set.
* **Passphrase mode** produces a hyphenated word passphrase from a built-in 256-word list (8 bits of entropy per word) — easier to remember. In this mode the slider chooses the **word count**; aim for 6–7 words.
* A live **strength meter** shows the estimated entropy in bits (weak / fair / strong / excellent).
* **Copy** places the result on the clipboard, with an `execCommand` fallback for mobile browsers that reject the async clipboard API.

---

## Project Structure

```
opera/
├── domain-css-injector-v2/      ← the extension (Manifest V3)
│   ├── manifest.json            ← MV3 manifest with action + sidebar_action
│   ├── popup.html               ← collapsible-section UI (popup on Chrome, sidebar on Opera)
│   ├── popup.js                 ← editor logic, TTS, video extraction, snippets
│   ├── popup-notepad.js         ← per-domain notepad
│   ├── popup-password.js        ← crypto password / passphrase generator
│   ├── content.js               ← injects CSS, runs the inspect-element overlay
│   ├── background.js            ← service worker — context-menu video downloads
│   └── icons/                   ← 16 / 48 / 128 px PNG icons
├── .github/                     ← CI, release, and dependency automation
│   ├── dependabot.yml           ← weekly GitHub Actions updates
│   └── workflows/
│       ├── ci.yml               ← extension lint / validation
│       └── release.yml          ← tagged production builds (zip + GitHub Release)
├── pwa-inventory.md             ← chrome.storage and manifest inventory (per repo standards)
├── CLAUDE.md                    ← architecture source of truth
├── LICENSE                      ← MIT
└── README.md                    ← this file
```

**For everyday use** you only touch:

* `domain-css-injector-v2/popup.html` — the editor markup and styles
* `domain-css-injector-v2/popup.js` — editor behavior and the media / TTS features
* `domain-css-injector-v2/content.js` — what runs on the page itself

**For deeper changes** see [`CLAUDE.md`](./CLAUDE.md).

---

## License

MIT © 2026 Ranzlappen. See [`LICENSE`](./LICENSE).
