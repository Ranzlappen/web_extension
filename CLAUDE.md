# Opera

Per-domain CSS injection plus a small toolbox (selector inspector, TTS reader, video-media downloader) packaged as a Manifest V3 browser extension. Hosted as an unpacked extension loaded directly from `domain-css-injector-v2/`.

## Architecture

Single-module Chromium / Firefox browser extension. No bundler, no build step, no backend. The extension is loaded directly from the `domain-css-injector-v2/` folder and persists everything to `chrome.storage.local`.

* **Pageside** (`domain-css-injector-v2/`) — Manifest V3 extension. `popup.html` is the editor UI, served as the toolbar popup on Chrome / Edge (`action`) and as the sidebar panel on Opera / Firefox (`sidebar_action`). `content.js` runs at `document_start` on every URL, reads the saved CSS for the page's base domain, and injects a `<style id="__ps_kx9w4_style">` element (skipped while the domain is listed in the `__ps_off` map; a `PS_PREVIEW` message swaps in a temporary `<style id="__ps_kx9w4_prev">` carrying the editor's unsaved CSS until the next save/delete or reload). `popup.js` drives the editor (save / delete / per-site on-off toggle / live preview / quick CSS presets / JSON export **and** import), the inspect-element overlay, the Web-Speech TTS (selected text or whole page, chunked to dodge Chromium's ~15 s utterance cutoff, with a rate slider), a visible-tab screenshot saved via `chrome.downloads` (`chrome.tabs.captureVisibleTab`, covered by the existing `activeTab` / `<all_urls>` grants), and the popup-driven `chrome.downloads` video pipeline. Three sibling modules load alongside it: `popup-notepad.js` (per-domain notepad backed by `chrome.storage.local["__ps_notes"]`), `popup-password.js` (a Web-Crypto password / passphrase generator that stores nothing), and `popup-tabs.js` (a tab organizer — sort, group-by-domain, close-duplicates, and list/jump across all windows via `chrome.tabs` / `chrome.tabGroups`, storing nothing). `background.js` is the MV3 service worker — it registers the `chrome.contextMenus` "Download this video" entry against `<video>` elements and routes the click into `chrome.downloads`. The user-facing extension name is intentionally a generic value so detection scripts that fingerprint by extension name don't trip; the directory and storage-key contract are unchanged.

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
* **Internal keys use the reserved `__ps_` prefix.** Non-CSS state (currently `__ps_notes`, the per-domain notepad map; `__ps_lasthost`, the foreground host the content script records for fallback site-detection on Kiwi; and `__ps_off`, the map of domains whose saved CSS is temporarily switched off via the Style section's per-site toggle) is namespaced under `__ps_` so it can never collide with a bare-domain CSS key. Any such key MUST be excluded from `renderSnippets()` and from **Export JSON** (both gated on `isReservedKey()` in `popup.js`) so it never surfaces as a fake CSS snippet or leaks into a backup. Reuse this prefix for any future internal key.
* **Two entry surfaces, one HTML.** `popup.html` must keep working as both a Chrome `action` popup (fixed-size, mouse-driven, opens on toolbar click) and an Opera / Firefox `sidebar_action` panel (variable width, can be tall). Don't bake fixed pixel widths into the body. The UI is a set of native `<details>`/`<summary>` collapsible sections (Style / Notes / Password / Tools / Tabs) tuned for mobile/Kiwi: 16px base font (18px ≥520px), `env(safe-area-inset-*)` padding, 44px tap targets. `popup.html` loads `popup.js` (orchestrator), then `popup-notepad.js`, `popup-password.js`, and `popup-tabs.js` as classic scripts sharing its global scope; `popup.js` fires a `ps:hostchange` `CustomEvent` on each domain switch that the notepad and tabs modules consume.
* **Content script runs on every URL.** `content.js` is registered at `document_start` with `<all_urls>`. Keep it small and side-effect-free until a saved snippet is found, and don't introduce throws on the top-level path.
* **Identifier surface is deliberately neutral.** The extension `name`, the injected `<style>` element id (`__ps_kx9w4_style`), the runtime DOM additions, and the message-channel types (`PS_START_PICK`, …) are intentionally generic / randomized so anti-extension detection scripts can't fingerprint the extension by name or marker. If you change one, change the other end of the channel too.
* **Dual manifest: MV3 desktop, MV2 for Kiwi/Android.** `manifest.json` is Manifest V3 (the Chrome Web Store / AMO contract and the desktop target). Kiwi and other Android Chromium forks only support MV2 reliably — they **silently fail to load** an MV3 manifest — so the mobile build ships as Manifest V2. The MV2 manifest is **derived** from `manifest.json` by `tools/build-kiwi-manifest.mjs` (single source of truth; never hand-maintain a second manifest), and `tools/build-kiwi-zip.sh` packages the `-kiwi.zip`. The **same JS runs under both**: `popup.js` feature-detects `chrome.scripting` (MV3) vs `chrome.tabs.executeScript` (MV2) via the `injectFunc()` / `injectFile()` helpers — use those, never call `chrome.scripting` directly. `background.js` uses only APIs (`contextMenus`, `downloads`) that exist in both. CI validates the derived MV2 manifest stays in parity (version/name) and well-formed.
* **Permissions are intentionally narrow.** Active operations use `activeTab` + `scripting` so the extension only touches a tab when the user opens the popup. `contextMenus` is held by the background service worker only, for the right-click "Download this video" entry. `tabs` backs both the active-site detection and the **Tabs** organizer (sort / dedupe / list across windows). `tabGroups` backs only the organizer's _Group by domain_ action — it is **Chrome/Edge-desktop only**, feature-detected at runtime (`typeof chrome.tabs.group === 'function'`), and **stripped from the MV2 (Kiwi) build** by `tools/build-kiwi-manifest.mjs` (Kiwi/Firefox have no tab-groups API). Don't expand host access further without a feature that requires it.
* **No external network.** Snippets are local-only. There is no telemetry, no remote config, no auth. Adding a network call is a structural change and should be a separate PR.
* **Vanilla JS, no dependencies.** No npm, no bundler. Keep it that way unless a feature genuinely cannot be done without a dep.

## Deployment & CI/CD

| Workflow | Trigger | Scope | Deploys |
| --- | --- | --- | --- |
| `ci.yml` | PR / push touching `domain-css-injector-v2/**`, `tools/**`, or workflow itself | Validates `manifest.json`, runs `node --check` over each `.js`, confirms icon assets exist, and validates the derived Kiwi MV2 manifest (version/name parity, MV2 shape) | Nothing (validation only) |
| `release.yml` | tag push `v*` or manual dispatch | Validates, then builds **two** zips: `pageside-<version>.zip` (Manifest V3, desktop) and `pageside-<version>-kiwi.zip` (Manifest V2 for Kiwi / Android, derived via `tools/build-kiwi-zip.sh`); verifies `manifest.json` lands at each zip root | Uploads both as workflow artifacts and attaches both to a GitHub Release. **Manual dispatch auto-increments**: pick `patch`/`minor`/`major` and the workflow bumps `manifest.json`, commits the bump `[skip ci]`, pushes the `vX.Y.Z` tag, and publishes the Release — no manual version edit or tagging. Tag pushes release at that exact tag with no bump. |

**What fires on a given change:**

| Change | CI | Deploy |
| --- | --- | --- |
| Extension source in `domain-css-injector-v2/` | ✓ | — (release via tag push or dispatch) |
| Build helpers in `tools/` | ✓ | — |
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
│   ├── popup.html               # collapsible-section UI (popup or sidebar)
│   ├── popup.js                 # orchestrator — editor / inspect / TTS / downloads / snippets
│   ├── popup-notepad.js         # per-domain notepad module (__ps_notes)
│   ├── popup-password.js        # crypto password / passphrase generator module
│   ├── popup-tabs.js            # tab organizer — sort / group / dedupe / list across windows
│   ├── content.js               # CSS injector + inspect-mode overlay
│   ├── background.js            # service worker — context-menu "Download this video"
│   └── icons/                   # 16 / 48 / 128 px PNGs
├── tools/
│   ├── build-kiwi-manifest.mjs  # derives the MV2 (Kiwi) manifest from manifest.json
│   └── build-kiwi-zip.sh        # builds pageside-<version>-kiwi.zip locally
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

**Kiwi / Android needs Manifest V2.** Those forks have only experimental MV3 support and silently reject the MV3 `manifest.json` (the "I loaded the zip and nothing happened" symptom). Ship them the **`-kiwi.zip`** (Manifest V2, `browser_action` + non-persistent event page) produced by `tools/build-kiwi-zip.sh`. The MV2 build runs the identical content/popup scripts — only the manifest differs, and the popup's script-injection paths route through `injectFunc()` / `injectFile()` which fall back to `chrome.tabs.executeScript` when `chrome.scripting` is absent.

## Post-task self-check

After every turn that produces a branch, PR, feature, or bug fix, do a quick self-check before replying: does the change introduce anything worth codifying in docs or automation? Scan for new permissions in `manifest.json`, new `chrome.storage` keys, new content-script matches, new files under `domain-css-injector-v2/`, or new conventions that should be reflected in `README.md`, this file, `pwa-inventory.md`, `.github/workflows/ci.yml`, or `.github/dependabot.yml`.

Decide per case:

* **Auto-implement** small, unambiguous updates — e.g. listing a new `chrome.storage` key in `pwa-inventory.md`, extending the workflow's `paths` filter to a new directory, documenting a new permission in this file's "Key Conventions".
* **Prompt first** for anything ambiguous — renaming a storage key, changing the extension's manifest `action` shape, or restructuring the popup entry surfaces.

If nothing is warranted, say "no doc/workflow updates needed" in one line. Skip this self-check entirely for pure Q&A turns that don't change code.
