# Storage & Manifest Inventory

This repo is **not** a Progressive Web App — it is a Manifest V3 browser extension. There is no `sw.js`, no web-app `manifest.webmanifest`, no `.well-known/assetlinks.json`, and no TWA binding. However, it has installed users with persisted data (`chrome.storage.local`) and a `manifest.json` whose contract — installed-icon assets, popup entry, content-script match patterns — is identical in spirit to the PWA Refactor Addendum's "installed users have data and an app shell" guarantee.

This inventory captures every key, path, and identifier whose value is part of the extension's external contract. **Every value below is sacred** and must round-trip identically through any refactor.

---

## 1. Storage keys

`chrome.storage.local` is the only persistent store. Keys are dynamic — one per saved domain — and computed by `getBaseDomain(hostname)` (last two labels of the hostname).

| Key shape | Source of value | Type | Notes |
| --- | --- | --- | --- |
| `<base-domain>` (e.g. `example.com`) | `resolveBaseHost(window.location.hostname)` in `popup.js` and `content.js` (renamed from `getBaseDomain` in the obfuscation pass — same algorithm) | `string` (CSS source) | The set is open-ended — every domain the user has saved CSS for is one key. |

Read sites:

* `popup.js:49` — `chrome.storage.local.get([domain], …)` to load the editor for a domain
* `popup.js:111` — `chrome.storage.local.get(null, renderList)` to populate the saved-snippets list
* `popup.js:295` — `chrome.storage.local.get(null, …)` for **Export JSON**
* `content.js:9` — `chrome.storage.local.get([domain], …)` to inject CSS at `document_start`
* `content.js:17` — `chrome.storage.onChanged` listener for live updates

Write sites:

* `popup.js:77` — `chrome.storage.local.set({ [currentDomain]: css }, …)` on **Save**
* `popup.js:84` — `chrome.storage.local.remove([currentDomain], …)` on **Delete**

## 2. Schema versions

None. There is no migration pipeline, no `schemaVersion` constant, and no version key in `chrome.storage`. The data shape has been a flat `domain → cssString` map for the entire lifetime of the extension. Any future change that introduces structure (e.g. wrapping the value in an object) **must** ship behind an explicit migration.

## 3. Service worker

The extension ships a single MV3 background service worker at `domain-css-injector-v2/background.js`, declared in the manifest as:

```jsonc
// manifest.json
"background": {
  "service_worker": "background.js",
  "scripts": ["background.js"]
}
```

`service_worker` is the Chromium entry point; `scripts` is the Firefox-compatible
fallback (Firefox MV3 runs `background.scripts` as an event page). Both point at
the same `background.js`, which registers all its listeners at top level so it
works under either runtime. Chrome ignores `scripts`; Firefox ignores
`service_worker`. AMO validation **requires** the pairing — do not drop `scripts`.

It subscribes to:

* `chrome.runtime.onInstalled` — registers the `chrome.contextMenus` entry once at install.
* `chrome.runtime.onStartup` — re-registers the same entry per session (defensive — `onInstalled` only fires on install / update).
* `chrome.contextMenus.onClicked` — when the user picks **Download this video** on a `<video>` element, it forwards `info.srcUrl` to `chrome.downloads.download` with `conflictAction: 'uniquify'` (skipping `blob:` URLs, mirroring popup-side behavior).

The on-page code is still a content script registered at `document_start`:

```jsonc
// manifest.json
"content_scripts": [
  {
    "matches": ["<all_urls>"],
    "js": ["content.js"],
    "run_at": "document_start"
  }
]
```

The injected `<style>` element id is `__ps_kx9w4_style` (deliberately neutral / randomized so anti-extension scripts cannot fingerprint it). Round-trip the same id in `content.js` if it is ever changed.

## 4. Manifest paths

Every path-shaped value in `domain-css-injector-v2/manifest.json` and the file it resolves to:

| Manifest field | Value | Resolves to |
| --- | --- | --- |
| `icons["16"]` | `icons/icon16.png` | `domain-css-injector-v2/icons/icon16.png` ✓ |
| `icons["48"]` | `icons/icon48.png` | `domain-css-injector-v2/icons/icon48.png` ✓ |
| `icons["128"]` | `icons/icon128.png` | `domain-css-injector-v2/icons/icon128.png` ✓ |
| `action.default_popup` | `popup.html` | `domain-css-injector-v2/popup.html` ✓ |
| `action.default_icon["16"]` | `icons/icon16.png` | ✓ |
| `action.default_icon["48"]` | `icons/icon48.png` | ✓ |
| `action.default_icon["128"]` | `icons/icon128.png` | ✓ |
| `sidebar_action.default_panel` | `popup.html` | `domain-css-injector-v2/popup.html` ✓ |
| `sidebar_action.default_icon["16"]` | `icons/icon16.png` | ✓ |
| `sidebar_action.default_icon["48"]` | `icons/icon48.png` | ✓ |
| `sidebar_action.default_icon["128"]` | `icons/icon128.png` | ✓ |
| `content_scripts[0].js[0]` | `content.js` | `domain-css-injector-v2/content.js` ✓ |
| `background.service_worker` | `background.js` | `domain-css-injector-v2/background.js` ✓ |
| `background.scripts[0]` | `background.js` | `domain-css-injector-v2/background.js` ✓ (Firefox fallback) |

The Firefox add-on identity lives in `browser_specific_settings.gecko`:

| Manifest field | Value | Notes |
| --- | --- | --- |
| `browser_specific_settings.gecko.id` | `{f2ee7814-cda2-4bda-8deb-3f6bb90d5080}` | **Permanent** add-on ID on AMO. Required for MV3. Once published it can never change without creating a brand-new listing — treat it as sacred. |
| `browser_specific_settings.gecko.data_collection_permissions.required` | `["none"]` | Declares the extension collects no user data (it has no network calls). Required for new Firefox extensions. |

`name`, `version`, `description`, and the permissions list are part of the same contract — changing `name` will rename the entry on every installed user's toolbar / sidebar; changing `version` is required for any update; changing the permissions set requires re-prompting the user. The current obfuscation pass renamed `name` to `Pageside` (intentionally neutral) and added the `contextMenus` permission to back the right-click "Download this video" entry; both are intentional and documented.

## 5. TWA binding

None. There is no `.well-known/assetlinks.json`, no Android Trusted Web Activity, no Play Store binding.

## 6. Permissions requested

Declared in `manifest.json` (granted at install time):

* `storage` — for `chrome.storage.local` reads/writes
* `activeTab` — to read the active tab's URL when the popup opens
* `scripting` — to run the video-source scanner via `chrome.scripting.executeScript`
* `tabs` — to query / message the active tab from the popup
* `clipboardWrite` — used by the inspect-element overlay to copy a selector
* `downloads` — to hand a media URL to `chrome.downloads.download`
* `contextMenus` — used by `background.js` to register the right-click **Download this video** entry on `<video>` elements

Host permission: `<all_urls>` (required because the extension targets any site the user wants to style).

Runtime gestures:

* Web Speech (`speechSynthesis.speak`) — gated on the **Read Selected Text** button click in `popup.js`
* `navigator.clipboard.writeText` — gated on a click within the page during picker mode (`content.js`, in `onPickerSelect`)
* `chrome.downloads.download` — gated on either the popup's **Download Video Media** button click (`popup.js`, in `pickAndSaveMedia`) or the right-click context-menu **Download this video** entry handled by `background.js`

These gestures must stay attached to their current click handlers; moving them to module-load time will silently break the feature.

## 7. External dependencies

None. No CDN scripts, no remote imports, no `<script src="https://…">` tags. Every byte the extension runs ships in this repo.

## 8. UI entry surfaces

Two surfaces, one HTML file:

* `action.default_popup` → `popup.html` — the toolbar popup on Chrome / Edge
* `sidebar_action.default_panel` → `popup.html` — the sidebar panel on Opera / Firefox

Both surfaces must continue to render `popup.html` correctly. The styles in `popup.html` are intentionally width-agnostic so the same file works as a fixed Chrome popup and as a flexible Opera sidebar.

---

## Verification

After this elevation PR, walk the inventory:

* [✓] Every storage key still computed from the same algorithm — function renamed (`getBaseDomain` → `resolveBaseHost`) but the per-domain key shape and the last-two-labels rule are unchanged. No schema change.
* [✓] Schema version: still none. No migration pipeline added.
* [✓] Service worker added (`background.js`) for the right-click **Download this video** entry only. Content-script entry unchanged (`content.js` at `document_start`, `<all_urls>`).
* [✓] Every manifest path still resolves to an existing file in `domain-css-injector-v2/`.
* [✓] No TWA / `assetlinks.json` involved.
* [✓] Permission set extended by `contextMenus` only (documented above). Click-gesture bindings unchanged for the popup-driven flows; new gesture is the native context-menu click handled by `background.js`.
* [✓] No external CDN dependencies introduced.
* [✓] `popup.html` still renders on both `action` and `sidebar_action`.

If any line above is not ✓, the PR is not ready.
