# Opera

Per-domain CSS injection, container inspection, TTS reading, and video-media downloads — packaged as a single Manifest V3 browser extension that works in Chromium browsers (Opera, Chrome, Edge) and Firefox.

> **New here?** If you just want to install and use the extension, jump to [Getting Started](#getting-started). If you're a developer or want to understand the architecture, see [`CLAUDE.md`](./CLAUDE.md).

---

## What this is

A lightweight browser extension that lets you author and persist a CSS snippet per domain. Open the popup (Chrome/Edge) or the sidebar panel (Opera/Firefox), type CSS, and it is injected into every page on that domain on every visit. The popup also exposes a quick element inspector that copies a CSS selector to the clipboard, a Web-Speech TTS reader for selected text, and a media-URL extractor that can download `<video>` sources straight from the active tab.

Everything is stored locally via `chrome.storage.local` — there is no server, no account, and no telemetry.

---

## Quick Reference

The most common tasks. For anything not listed, see [Developer Setup](#developer-setup) or [`CLAUDE.md`](./CLAUDE.md).

| I want to... | Do this |
| --- | --- |
| Install the extension | Open `chrome://extensions` (or `opera://extensions`), enable **Developer mode**, click **Load unpacked**, and select the `domain-css-injector-v2/` folder. |
| Open the editor on Chrome / Edge | Click the **CSS Injector** toolbar icon — the popup opens. |
| Open the editor on Opera / Firefox | Open the browser **sidebar** and pick **CSS Injector**. |
| Add CSS for a site | Visit the site, open the editor, type CSS, click **Save CSS changes**. |
| Remove CSS for a site | Visit the site, open the editor, click **Delete CSS for this Page**. |
| Copy a selector from the page | Click **Select Container**, hover over the element, click it. The selector is copied to the clipboard. |
| Read selected text aloud | Select text on the page, open the editor, click **Read Selected Text**. |
| Download a `<video>` from a page | Open the editor, click **Download Video Media**, pick a source from the prompt. |
| Back up all snippets | Open the editor, click **Export JSON**. |
| Restore a snippet on another browser | Open the editor on the target site, paste the JSON value into the editor, **Save**. |

---

## Getting Started

The extension is distributed as an unpacked folder. Install steps are the same on Windows, macOS, and Linux Chromium browsers.

1. Download or clone this repo to your machine.
2. Open `chrome://extensions` (Chrome / Edge) or `opera://extensions` (Opera).
3. Toggle **Developer mode** on (top-right).
4. Click **Load unpacked** and select the `domain-css-injector-v2/` folder inside this repo.
5. Pin the **CSS Injector** icon to the toolbar so the popup is one click away.

> **Mobile note.** Chrome on Android does not support extensions, so installation is desktop-only. The extension is built to render correctly on every supported desktop Chromium browser regardless of viewport width — including narrow Opera sidebars and Edge's compact popup.

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

---

## How to add CSS for a domain

1. Visit the site you want to style (e.g. `https://example.com`).
2. Open the editor (toolbar icon on Chrome / Edge, sidebar on Opera / Firefox).
3. The popup detects the **base domain** (e.g. `example.com` for `www.example.com`) and shows it under "Detected domain".
4. Type or paste your CSS:
   ```css
   body { background: #0f121c; color: #e6e8ef; }
   a    { color: #4aa3ff; }
   ```
5. Click **Save CSS changes**. The page reflects the change immediately and on every future visit.

Saved snippets appear in the **Saved snippets** list at the bottom of the popup. Click any entry to load it back into the editor.

---

## How to download a video from a page

1. Open the page that has a `<video>` element.
2. Open the editor and click **Download Video Media**.
3. The popup scans every frame for `video.currentSrc`, `<source>` tags, media-typed `<a href>` links, network resource entries, and (on YouTube) `ytInitialPlayerResponse`.
4. A prompt lists every candidate ranked by likelihood of being a real downloadable file. Enter the number you want.
5. The extension hands the URL to `chrome.downloads` with `conflictAction: 'uniquify'`. Blob streams (`blob:`) are skipped — they cannot be downloaded directly.

---

## Project Structure

```
opera/
├── domain-css-injector-v2/      ← the extension (Manifest V3)
│   ├── manifest.json            ← MV3 manifest with action + sidebar_action
│   ├── popup.html               ← editor UI (popup on Chrome, sidebar on Opera)
│   ├── popup.js                 ← editor logic, TTS, video extraction
│   ├── content.js               ← injects CSS, runs the inspect-element overlay
│   └── icons/                   ← 16 / 48 / 128 px PNG icons
├── .github/                     ← CI and dependency automation
│   ├── dependabot.yml           ← weekly GitHub Actions updates
│   └── workflows/
│       └── ci.yml               ← extension lint / validation
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
