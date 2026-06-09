# Opera

Per-domain CSS injection plus a small toolbox (selector inspector, TTS reader, video-media downloader) packaged as a Manifest V3 browser extension. Hosted as an unpacked extension loaded directly from `domain-css-injector-v2/`.

## Architecture

Single-module Chromium / Firefox browser extension. No bundler, no build step, no backend. The extension is loaded directly from the `domain-css-injector-v2/` folder and persists everything to `chrome.storage.local`.

* **Pageside** (`domain-css-injector-v2/`) — Manifest V3 extension. `popup.html` is the editor UI, served as the toolbar popup on Chrome / Edge (`action`) and as the sidebar panel on Opera / Firefox (`sidebar_action`). `content.js` runs at `document_start` on every URL, reads the saved CSS for the page's base domain, and injects a `<style id="__ps_kx9w4_style">` element. `popup.js` drives the editor, the inspect-element overlay, the Web-Speech TTS, and the popup-driven `chrome.downloads` video pipeline. `background.js` is the MV3 service worker — it registers the `chrome.contextMenus` "Download this video" entry against `<video>` elements and routes the click into `chrome.downloads`. The user-facing extension name is intentionally a generic value so detection scripts that fingerprint by extension name don't trip; the directory and storage-key contract are unchanged.

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

* **Storage keys are domain strings.** Each saved snippet lives under `chrome.storage.local[<base-domain>]` where the key is computed by `resolveBaseHost(hostname)` (the renamed `getBaseDomain`) — last two labels of the hostname (`www.foo.example.com` → `example.com`). These keys are a public API of the extension; never rename or reformat them. The full inventory lives in [`pwa-inventory.md`](./pwa-inventory.md).
* **Two entry surfaces, one HTML.** `popup.html` must keep working as both a Chrome `action` popup (fixed-size, mouse-driven, opens on toolbar click) and an Opera / Firefox `sidebar_action` panel (variable width, can be tall). Don't bake fixed pixel widths into the body.
* **Content script runs on every URL.** `content.js` is registered at `document_start` with `<all_urls>`. Keep it small and side-effect-free until a saved snippet is found, and don't introduce throws on the top-level path.
* **Identifier surface is deliberately neutral.** The extension `name`, the injected `<style>` element id (`__ps_kx9w4_style`), the runtime DOM additions, and the message-channel types (`PS_START_PICK`, …) are intentionally generic / randomized so anti-extension detection scripts can't fingerprint the extension by name or marker. If you change one, change the other end of the channel too.
* **Permissions are intentionally narrow.** Active operations use `activeTab` + `scripting` so the extension only touches a tab when the user opens the popup. `contextMenus` is held by the background service worker only, for the right-click "Download this video" entry. Don't expand to `tabs` host access without a feature that requires it.
* **No external network.** Snippets are local-only. There is no telemetry, no remote config, no auth. Adding a network call is a structural change and should be a separate PR.
* **Vanilla JS, no dependencies.** No npm, no bundler. Keep it that way unless a feature genuinely cannot be done without a dep.

## Deployment & CI/CD

| Workflow | Trigger | Scope | Deploys |
| --- | --- | --- | --- |
| `ci.yml` | PR / push touching `domain-css-injector-v2/**` or workflow itself | Validates `manifest.json`, runs `node --check` over each `.js`, confirms icon assets exist | Nothing (validation only) |
| `release.yml` | tag push `v*` or manual dispatch | Validates, then zips `domain-css-injector-v2/` into `pageside-<version>.zip` (and verifies `manifest.json` lands at the zip root) | Uploads as workflow artifact and attaches the zip to a GitHub Release. **Manual dispatch auto-increments**: pick `patch`/`minor`/`major` and the workflow bumps `manifest.json`, commits the bump `[skip ci]`, pushes the `vX.Y.Z` tag, and publishes the Release — no manual version edit or tagging. Tag pushes release at that exact tag with no bump. |

**What fires on a given change:**

| Change | CI | Deploy |
| --- | --- | --- |
| Extension source in `domain-css-injector-v2/` | ✓ | — (release via tag push or dispatch) |
| Docs (`README.md`, `CLAUDE.md`, `pwa-inventory.md`) | — | — |
| `.github/workflows/*.yml` | ✓ | — |
| Tag `v*` pushed | ✓ | ✓ (zip + GitHub Release) |
| Manual `release.yml` dispatch | — (bump commit is `[skip ci]`) | ✓ (auto-bump + tag + zip + GitHub Release) |

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
│   ├── manifest.json            # MV3 manifest — action + sidebar_action + content script + service worker
│   ├── popup.html               # editor UI (popup or sidebar)
│   ├── popup.js                 # editor / inspect / TTS / popup-driven downloads
│   ├── content.js               # CSS injector + inspect-mode overlay
│   ├── background.js            # service worker — context-menu "Download this video"
│   └── icons/                   # 16 / 48 / 128 px PNGs
├── .github/
│   ├── dependabot.yml           # weekly GitHub Actions updates
│   └── workflows/
│       ├── ci.yml               # validation
│       └── release.yml          # zip + GitHub Release on v* tag
├── pwa-inventory.md             # storage / manifest inventory
├── README.md                    # user-facing docs
├── CLAUDE.md                    # this file
└── LICENSE                      # MIT
```

## Browser compatibility

`action` (toolbar popup) is the Chrome / Edge entry point. `sidebar_action` is the Opera / Firefox entry point. Both target the same `popup.html`. Chrome silently ignores `sidebar_action`; Opera honors both keys but uses the sidebar surface preferentially. Don't remove either without checking the other surface.

Chrome on Android does not support extensions, but Chromium-fork phone browsers (Kiwi, Mises, Yandex, Lemur) and Firefox Nightly for Android do — see the **Mobile installation** section in `README.md`. Desktop Chrome on Windows / macOS / Linux remains the primary target alongside Opera.

## Post-task self-check

After every turn that produces a branch, PR, feature, or bug fix, do a quick self-check before replying: does the change introduce anything worth codifying in docs or automation? Scan for new permissions in `manifest.json`, new `chrome.storage` keys, new content-script matches, new files under `domain-css-injector-v2/`, or new conventions that should be reflected in `README.md`, this file, `pwa-inventory.md`, `.github/workflows/ci.yml`, or `.github/dependabot.yml`.

Decide per case:

* **Auto-implement** small, unambiguous updates — e.g. listing a new `chrome.storage` key in `pwa-inventory.md`, extending the workflow's `paths` filter to a new directory, documenting a new permission in this file's "Key Conventions".
* **Prompt first** for anything ambiguous — renaming a storage key, changing the extension's manifest `action` shape, or restructuring the popup entry surfaces.

If nothing is warranted, say "no doc/workflow updates needed" in one line. Skip this self-check entirely for pure Q&A turns that don't change code.
