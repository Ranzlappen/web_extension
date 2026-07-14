# Pageside — Privacy Policy

_Last updated: 2026-07-13_

Pageside is a browser extension that lets you save a custom CSS snippet per
website, plus a small set of page tools (element picker, text-to-speech
reader, per-site notepad, password generator, and tab organizer; the
self-hosted builds distributed on GitHub additionally include a page
screenshot and a page-media saver).

## The short version

**Pageside collects nothing.** It has no server, no analytics, no telemetry,
no accounts, and it never transmits any data off your device. Everything you
create in the extension is stored locally in your browser and nowhere else.

## What the extension stores, and where

All data lives exclusively in your browser's local extension storage
(`chrome.storage.local`) on your own device:

| Data | Why | Where it goes |
| --- | --- | --- |
| CSS snippets you write, keyed by site domain | So your styles re-apply on your next visit | Local extension storage only |
| Per-site notes you type in the Notes section | So your note reloads on that site | Local extension storage only |
| Unsaved editor drafts | So closing the popup mid-edit loses nothing | Local extension storage only |
| Per-site on/off toggle state | So a disabled site stays disabled | Local extension storage only |
| The domain of the page you last viewed | Used only as a fallback for site detection in the popup | Local extension storage only |

Generated passwords are **never stored anywhere** — they exist only in the
popup until you close it.

Uninstalling the extension deletes all of this data. The **Export JSON**
feature writes a backup file to a location you choose; that file never leaves
your device unless you move it yourself.

## What the extension does NOT do

* No data is sent to the developer or to any third party.
* No analytics, tracking, fingerprinting, or advertising identifiers.
* The popup contains a "Support this project" text link to the developer's
  Ko-fi page. It is a plain link: nothing is loaded from Ko-fi unless you
  click it, and clicking simply opens the page in a new browser tab.
* No reading of passwords, form fields, or keystrokes on web pages.
* No remote code — every line of code ships inside the extension package.
* No sale or transfer of user data to anyone, for any purpose.

## Permissions explained

| Permission | What it is used for |
| --- | --- |
| Access to websites (`<all_urls>`) | Applying **your own** saved CSS to pages as they load. The content script reads only the page's domain to look up your snippet; it does not read or report page content. |
| `storage` | Saving your snippets, notes, and settings locally. |
| `activeTab` / `scripting` | Running the element picker, text-to-speech reader, screenshot, and media scanner on the current tab — only when you click those buttons in the popup. |
| `tabs` | Detecting the current site's domain, and powering the optional tab organizer (sort / group / close duplicates). Tab titles and URLs are read in-memory only and never stored or transmitted. |
| `tabGroups` | The optional "Group by domain" tab-organizer action (Chrome desktop only). |
| `clipboardWrite` | Copying a CSS selector or a generated password to your clipboard when you press Copy. |
| `downloads` *(self-hosted builds only — not in the Chrome Web Store package)* | Saving screenshots and page media through the browser's own download manager, at your explicit request. |
| `contextMenus` *(self-hosted builds only — not in the Chrome Web Store package)* | The right-click "Download this video" menu entry. |

## Changes to this policy

If a future version of Pageside ever changes what data is handled, this
document will be updated and the change will be called out in the release
notes before it ships.

## Contact

Questions or concerns: open an issue at
<https://github.com/Ranzlappen/web_extension/issues>.
