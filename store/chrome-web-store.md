# Chrome Web Store — listing content & publishing guide

Everything needed to publish Pageside to the Chrome Web Store. Copy-paste the
text blocks below into the Developer Dashboard fields. The upload artifact is
the **MV3 zip** built by `release.yml` (`pageside-<version>.zip`) — download it
from the GitHub Release assets, **not** from the Actions artifacts UI (which
double-wraps the zip).

---

## 1. One-time account setup

1. Go to <https://chrome.google.com/webstore/devconsole> and sign in with the
   Google account that should own the listing.
2. Pay the **one-time $5 developer registration fee**.
3. Enable **2-step verification** on the account (required to publish).
4. In the dashboard's **Account** tab, fill in a contact email and verify it —
   listings cannot be published without a verified contact email.

## 2. Upload

1. Dashboard → **Items** → **New item** → upload `pageside-<version>.zip`.
2. The manifest may produce non-blocking warnings for `sidebar_action` and
   `browser_specific_settings` (Opera/Firefox keys that Chrome ignores).
   Warnings do not block publication. If the upload is *rejected* over
   `background.scripts`, remove that key (keep `service_worker`) from the
   manifest in a store-only copy of the zip and re-upload.

## 3. Store listing tab

**Title:** `Pageside`

**Short description** (132-char limit):

> Per-site custom CSS with live preview, an element hider, text-to-speech
> reader, page tools, and a tab organizer. 100% local.

**Category:** Productivity → Developer Tools (or Accessibility — pick one;
Developer Tools fits the CSS editor best).

**Language:** English

**Detailed description:**

```
Pageside lets you restyle any website with your own CSS — and keeps a small
toolbox of page utilities one click away. Everything runs and stays on your
device: no account, no server, no tracking.

STYLE ANY SITE
• Write CSS for the current site; it re-applies automatically on every visit
• Live preview before saving, per-site on/off switch, quick-start presets
  (dark mode, hide sticky/cookie bars, readable text, bigger text)
• Editor with line numbers, Tab indentation, Ctrl/Cmd+S, and automatic
  draft recovery
• Element picker: click any element to copy its CSS selector — or use Hide
  Element to remove it from the site permanently with one tap
• Export and import all your snippets as JSON

READ & CAPTURE
• Text-to-speech: read the selected text or the whole page aloud, with an
  adjustable speed slider
• One-tap screenshot of the visible page, saved to your downloads
• Save page media: scan the current tab for <video> sources and download
  them through the browser's download manager, or right-click any video and
  choose "Download this video"

SMALL EXTRAS
• Per-site private notepad (stored locally, excluded from exports)
• Cryptographic password & passphrase generator (nothing is ever stored)
• Tab organizer: sort tabs, group by domain, close duplicates, and jump to
  any open tab across windows

PRIVACY
Pageside has no server and sends nothing anywhere. Snippets, notes, and
settings live only in your browser's local extension storage. See the
privacy policy for details.
```

**Graphic assets:**

| Asset | Requirement | File |
| --- | --- | --- |
| Store icon | 128×128 PNG | `domain-css-injector-v2/icons/icon128.png` |
| Screenshots (1–5) | 1280×800 (or 640×400) PNG/JPEG | `store/screenshots/*.png` (regenerate with `tools/make-store-screenshots.mjs`) |
| Small promo tile | 440×280 (optional) | — |
| Marquee promo | 1400×560 (optional) | — |

## 4. Privacy practices tab (required — most rejections happen here)

**Single purpose description:**

> Pageside's single purpose is customizing and interacting with the page you
> are viewing: applying user-authored per-site CSS, and offering related
> on-page utilities (element picker, read-aloud, screenshot, media saver,
> per-site notes) plus tab organization, all operating locally.

**Permission justifications** (one field per permission):

| Permission | Justification to paste |
| --- | --- |
| `storage` | Saves the user's per-site CSS snippets, per-site notes, and editor drafts locally so they persist between visits. Nothing is transmitted. |
| `activeTab` | Lets popup-initiated actions (element picker, read-aloud, screenshot, media scan) run on the tab the user is looking at, only when the user clicks the corresponding button. |
| `scripting` | Injects the small helper functions that power the popup-initiated actions above into the active tab. No remote code; all scripts ship in the package. |
| `tabs` | Reads the active tab's URL to detect which site's CSS snippet to load in the editor, and powers the tab organizer (sort, group, close duplicates, jump to tab). Tab data is used in-memory only. |
| `tabGroups` | Used solely by the tab organizer's optional "Group by domain" action to create native tab groups on Chrome desktop. |
| `downloads` | Saves user-requested screenshots and page media files through the browser's download manager. Downloads occur only on explicit user action. |
| `clipboardWrite` | Copies a CSS selector or a generated password to the clipboard when the user presses a Copy button. |
| `contextMenus` | Adds the right-click "Download this video" entry on video elements. |
| Host permission `<all_urls>` | The core feature applies the user's saved CSS to sites as they load; the content script must run at document_start on any site the user has styled. It reads only the page's hostname to look up the user's snippet and injects only the user's own CSS. |

**Remote code:** answer **No** — all code is packaged; there is no remote
JS/WASM and no eval of fetched content.

**Data usage:** check **nothing** in the "What user data do you plan to
collect?" list (no categories apply — data never leaves the device), then
certify the three disclosures (no sale, no unrelated transfer, no
creditworthiness use).

**Privacy policy URL:**
`https://github.com/Ranzlappen/web_extension/blob/main/PRIVACY.md`
(must be publicly reachable — if the repo is private, publish PRIVACY.md via
GitHub Pages or a public Gist and use that URL instead).

## 5. Distribution tab

* **Visibility:** Public (or Unlisted for a soft launch — installable via
  direct link only, can be flipped to Public later without re-review).
* **Regions:** all.
* **Pricing:** free.

## 6. Submit & review

* Click **Submit for review**. Because the extension requests `<all_urls>`
  host permissions plus `tabs`, expect the **in-depth review track**: usually
  1–7 days, occasionally longer. Don't resubmit while a review is pending.
* Optional: enable **staged rollout** / keep "Publish automatically after
  review" ticked (default) or untick it to publish manually after approval.
* Rejection emails cite the policy section; fix, bump the version in
  `manifest.json` (or run the release workflow with a patch bump), and upload
  the new zip.

## 7. Updates after first publish

For each new version: run the **Release** workflow (patch/minor/major) →
download `pageside-<version>.zip` from the GitHub Release → dashboard →
**Package** → **Upload new package** → **Submit for review**. Listing text
and screenshots only need touching when features change.

## Known review risks & mitigations

* **Broad host access** — justified above; the reviewer may ask why
  `activeTab` alone isn't enough. Answer: saved CSS must re-apply on page
  load *without* a popup click, which requires a content script on all URLs.
* **Single-purpose policy** — the password generator and tab organizer are
  the furthest from the core purpose. If a rejection cites "multiple
  unrelated functionalities", the fallback is shipping those two sections
  behind a settings toggle or removing them from the store build.
* **Media saver wording** — never market it as a "video downloader" for
  copyrighted/streaming content. It cannot download DRM or blob streams
  (they are explicitly skipped), and the listing copy above frames it as
  saving page media via the browser's own download manager. Do not mention
  YouTube anywhere in the listing.
