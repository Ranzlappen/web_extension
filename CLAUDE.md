# Opera

Per-domain CSS injection plus a small toolbox (selector inspector, TTS reader, video-media downloader) packaged as a Manifest V3 browser extension. Hosted as an unpacked extension loaded directly from `domain-css-injector-v2/`.

## Architecture

Single-module Chromium / Firefox browser extension. No bundler, no build step, no backend. The extension is loaded directly from the `domain-css-injector-v2/` folder and persists everything to `chrome.storage.local`.

* **CSS Injector** (`domain-css-injector-v2/`) — Manifest V3 extension. `popup.html` is the editor UI, served as the toolbar popup on Chrome / Edge (`action`) and as the sidebar panel on Opera / Firefox (`sidebar_action`). `content.js` runs at `document_start` on every URL, reads the saved CSS for the page's base domain, and injects a `<style>` element. `popup.js` drives the editor, the inspect-element overlay, the Web-Speech TTS, and the `chrome.downloads` video pipeline.

## Build & Development

No build step. Load the extension unpacked, then click **Reload** on the extension card whenever a file changes.

```
# Load
# 1. Open chrome://extensions or opera://extensions
# 2. Toggle "Developer mode"
# 3. "Load unpacked" → select domain-css-injector-v2/

# Reload after edits
# Click the circular-arrow icon on the extension card.
```

## Key Conventions

* **Storage keys are domain strings.** Each saved snippet lives under `chrome.storage.local[<base-domain>]` where the key is computed by `getBaseDomain(hostname)` — last two labels of the hostname (`www.foo.example.com` → `example.com`). These keys are a public API of the extension; never rename or reformat them. The full inventory lives in [`pwa-inventory.md`](./pwa-inventory.md).
* **Two entry surfaces, one HTML.** `popup.html` must keep working as both a Chrome `action` popup (fixed-size, mouse-driven, opens on toolbar click) and an Opera / Firefox `sidebar_action` panel (variable width, can be tall). Don't bake fixed pixel widths into the body.
* **Content script runs on every URL.** `content.js` is registered at `document_start` with `<all_urls>`. Keep it small and side-effect-free until a saved snippet is found, and don't introduce throws on the top-level path.
* **Permissions are intentionally narrow.** Active operations use `activeTab` + `scripting` so the extension only touches a tab when the user opens the popup. Don't expand to `tabs` host access without a feature that requires it.
* **No external network.** Snippets are local-only. There is no telemetry, no remote config, no auth. Adding a network call is a structural change and should be a separate PR.
* **Vanilla JS, no dependencies.** No npm, no bundler. Keep it that way unless a feature genuinely cannot be done without a dep.

## Deployment & CI/CD

| Workflow | Trigger | Scope | Deploys |
| --- | --- | --- | --- |
| `ci.yml` | PR / push touching `domain-css-injector-v2/**` or workflow itself | Validates `manifest.json`, runs `node --check` over each `.js`, confirms icon assets exist | Nothing (validation only) |

**What fires on a given change:**

| Change | CI | Deploy |
| --- | --- | --- |
| Extension source in `domain-css-injector-v2/` | ✓ | — (manual: zip + upload) |
| Docs (`README.md`, `CLAUDE.md`, `pwa-inventory.md`) | — | — |
| `.github/workflows/*.yml` | ✓ | — |

**Concurrency**: `ci` cancels superseded runs per branch.

**Runtime versions**: Node 20 in CI (only used for `node --check` syntax validation).

**Required secrets**: none. The extension has no remote services.

## Tech Stack

| Layer | Technology | Role | Why |
| --- | --- | --- | --- |
| Platform | Manifest V3 | Extension runtime contract | Current Chromium standard |
| UI | Vanilla HTML + CSS | Popup / sidebar | No build step |
| Logic | Vanilla JS (ES2020) | Editor, content script | Keeps the extension dependency-free |
| Storage | `chrome.storage.local` | Per-domain snippets | Synced into the extension sandbox, no quota worries for small CSS strings |
| Speech | Web Speech API | TTS reader | Built into the browser |
| Downloads | `chrome.downloads` | Video media saver | Native Chromium download manager handles conflicts and progress |

## Project Structure

```
opera/
├── domain-css-injector-v2/
│   ├── manifest.json            # MV3 manifest — action + sidebar_action + content script
│   ├── popup.html               # editor UI (popup or sidebar)
│   ├── popup.js                 # editor / inspect / TTS / downloads
│   ├── content.js               # CSS injector + inspect-mode overlay
│   └── icons/                   # 16 / 48 / 128 px PNGs
├── .github/
│   ├── dependabot.yml           # weekly GitHub Actions updates
│   └── workflows/
│       └── ci.yml               # validation
├── pwa-inventory.md             # storage / manifest inventory
├── README.md                    # user-facing docs
├── CLAUDE.md                    # this file
└── LICENSE                      # MIT
```

## Browser compatibility

`action` (toolbar popup) is the Chrome / Edge entry point. `sidebar_action` is the Opera / Firefox entry point. Both target the same `popup.html`. Chrome silently ignores `sidebar_action`; Opera honors both keys but uses the sidebar surface preferentially. Don't remove either without checking the other surface.

Chrome on Android does not support extensions — that platform is intentionally out of scope. Desktop Chrome on Windows / macOS / Linux is the primary target alongside Opera.

## Post-task self-check

After every turn that produces a branch, PR, feature, or bug fix, do a quick self-check before replying: does the change introduce anything worth codifying in docs or automation? Scan for new permissions in `manifest.json`, new `chrome.storage` keys, new content-script matches, new files under `domain-css-injector-v2/`, or new conventions that should be reflected in `README.md`, this file, `pwa-inventory.md`, `.github/workflows/ci.yml`, or `.github/dependabot.yml`.

Decide per case:

* **Auto-implement** small, unambiguous updates — e.g. listing a new `chrome.storage` key in `pwa-inventory.md`, extending the workflow's `paths` filter to a new directory, documenting a new permission in this file's "Key Conventions".
* **Prompt first** for anything ambiguous — renaming a storage key, changing the extension's manifest `action` shape, or restructuring the popup entry surfaces.

If nothing is warranted, say "no doc/workflow updates needed" in one line. Skip this self-check entirely for pure Q&A turns that don't change code.
