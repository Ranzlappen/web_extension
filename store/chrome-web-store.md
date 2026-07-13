# Chrome Web Store — listing content & publishing guide

Everything needed to publish Pageside to the Chrome Web Store. Copy-paste the
text blocks below into the Developer Dashboard fields. The upload artifact is
the **store zip** built by `release.yml` (`pageside-<version>-store.zip`) —
download it from the GitHub Release assets, **not** from the Actions artifacts
UI (which double-wraps the zip). The store build is derived from the source by
`tools/build-store-package.mjs`: the Capture (screenshot) and Media (video
download) features are stripped, the unused `downloads` / `contextMenus`
permissions and the background worker are removed, and the Opera/Firefox-only
manifest keys are dropped. Those features remain in the regular
`pageside-<version>.zip` for self-hosted installs.

---

## 1. One-time account setup

1. Go to <https://chrome.google.com/webstore/devconsole> and sign in with the
   Google account that should own the listing.
2. Pay the **one-time $5 developer registration fee**.
3. Enable **2-step verification** on the account (required to publish).
4. In the dashboard's **Account** tab, fill in a contact email and verify it —
   listings cannot be published without a verified contact email.

## 2. Upload

1. Dashboard → **Items** → **New item** → upload `pageside-<version>-store.zip`.
2. The store manifest is pre-trimmed for Chrome (no `sidebar_action`,
   `browser_specific_settings`, or `background` keys), so the upload should
   produce no manifest warnings.

## 3. Store listing tab

**Title:** `Pageside`

**Short description** (132-char limit — matches the store manifest
description set by `tools/build-store-package.mjs`):

> Per-site custom CSS with live preview, element picker and hider,
> text-to-speech reader, site notes, and a tab organizer.

**Category:** Productivity → Developer Tools (or Accessibility — pick one;
Developer Tools fits the CSS editor best).

**Language:** English

**Detailed description** (deliberately frames every feature as one purpose —
a per-site companion panel — so the parts read as facets of the same tool,
not a grab-bag):

```
Pageside is a per-site companion panel: everything it does is organized
around the website you are currently viewing. Open the panel on a site and
you get your custom look for that site, your private notes about that site,
reading tools for that page, and quick ways to hop between the site's open
tabs. Everything runs and stays on your device: no account, no server, no
tracking.

MAKE ANY SITE LOOK THE WAY YOU WANT
• Write CSS for the current site; Pageside remembers it and re-applies it
  automatically on every future visit
• Live preview before saving, a per-site on/off switch, and quick-start
  presets: dark mode, hide sticky/cookie bars, readable text, bigger text
• A proper little editor: line numbers, Tab indentation, Ctrl/Cmd+S to
  save, and automatic draft recovery if you close the panel mid-edit
• Element picker: tap any element on the page to copy its exact CSS
  selector into your clipboard, ready to style
• Hide Element: tap anything — a cookie bar, a floating video, a nag
  banner — and it's gone from that site permanently (one saved CSS rule
  you can undo anytime)
• Back up every site's styles to a JSON file and restore them anywhere

READ THE PAGE YOUR WAY
• Text-to-speech for the page you're on: read the selected text or the
  whole article aloud, with an adjustable speed slider — hands-free
  reading for long pages

KEEP YOUR CONTEXT ON EVERY SITE
• A private notepad per site: jot down anything — it auto-saves, stays on
  your device, and reappears whenever you're back on that site
• Signing up on a site? Generate a strong password or passphrase right in
  the panel (cryptographic RNG, live strength meter). Nothing is ever
  stored — copy it into your password manager and it's gone

MOVE BETWEEN YOUR SITES
• Tab organizer: sort your open tabs by domain, title, or URL; group
  same-site tabs together; close duplicates; filter and jump to any tab
  across all windows

PRIVACY, PLAINLY
Pageside has no server and sends nothing anywhere. Your styles, notes, and
settings live only in your browser's local extension storage — uninstall
the extension and they're gone. No analytics, no accounts, no remote code.
```

**Graphic assets:**

| Asset | Requirement | File |
| --- | --- | --- |
| Store icon | 128×128 PNG | `domain-css-injector-v2/icons/icon128.png` |
| Screenshots (1–5) | 1280×800 (or 640×400) PNG/JPEG | `store/screenshots/*.png` (regenerate with `tools/make-store-screenshots.mjs`) |
| Small promo tile | 440×280 (optional) | `store/screenshots/promo-small-440x280.png` |
| Marquee promo | 1400×560 (optional) | `store/screenshots/promo-marquee-1400x560.png` |

## 4. Privacy practices tab (required — most rejections happen here)

**Single purpose description:**

> Pageside's single purpose is to be a per-site companion panel: it lets the
> user customize and manage their experience of the website they are
> currently viewing. Every feature operates on the current site — applying
> the user's own saved CSS to it (with an element picker/hider to build
> those styles), reading its content aloud, keeping the user's private notes
> for it, generating a password when registering on it, and organizing the
> browser's open tabs to move between sites. All data is stored locally;
> nothing is transmitted.

**Permission justifications** (one field per permission):

| Permission | Justification to paste |
| --- | --- |
| `storage` | Saves the user's per-site CSS snippets, per-site notes, and editor drafts locally so they persist between visits. Nothing is transmitted. |
| `activeTab` | Lets popup-initiated actions (element picker, read-aloud, screenshot, media scan) run on the tab the user is looking at, only when the user clicks the corresponding button. |
| `scripting` | Injects the small helper functions that power the popup-initiated actions above into the active tab. No remote code; all scripts ship in the package. |
| `tabs` | Reads the active tab's URL to detect which site's CSS snippet to load in the editor, and powers the tab organizer (sort, group, close duplicates, jump to tab). Tab data is used in-memory only. |
| `tabGroups` | Used solely by the tab organizer's optional "Group by domain" action to create native tab groups on Chrome desktop. |
| `clipboardWrite` | Copies a CSS selector or a generated password to the clipboard when the user presses a Copy button. |
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
download `pageside-<version>-store.zip` from the GitHub Release → dashboard →
**Package** → **Upload new package** → **Submit for review**. Listing text
and screenshots only need touching when features change.

## Known review risks & mitigations

* **Broad host access** — justified above; the reviewer may ask why
  `activeTab` alone isn't enough. Answer: saved CSS must re-apply on page
  load *without* a popup click, which requires a content script on all URLs.
* **Single-purpose policy** — mitigated three ways: the Capture/Media
  features (the riskiest, least-related surface) are stripped from the store
  build entirely; the listing copy frames every remaining feature as a facet
  of one per-site companion panel; and the single-purpose statement above
  says so explicitly. If a rejection still cites "multiple unrelated
  functionalities", the next fallback is stripping the password generator
  and tab organizer from the store build too (extend the
  `__PS_STORE_STRIP__` markers — see `tools/build-store-package.mjs`).
* **Do not re-add media downloading to the store build.** Chrome Web Store
  policy prohibits extensions that facilitate downloading streaming media,
  and YouTube-targeted extraction was deliberately removed from the source.
  The Capture/Media features live on only in the self-hosted
  `pageside-<version>.zip` / `-kiwi.zip` builds.
