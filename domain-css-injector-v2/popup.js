let activeHost = null;
let ttsVoice;
let ttsRate = 1;
// Reserved key: map of base-domain -> true for sites where the saved CSS is
// temporarily switched off (content.js skips injection while set).
const OFF_KEY = '__ps_off';

/* __PS_STORE_STRIP_START__ — Capture/Media: excluded from the Web Store build
   by tools/build-store-package.mjs. Keep every media/screenshot-only symbol
   inside a strip region so the stripped file still parses. */
let mediaCandidates = [];

function normalizeUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return null;
    const trimmed = rawUrl.trim();
    if (!trimmed) return null;
    try {
        return new URL(trimmed, window.location.href).href;
    } catch (_) {
        return null;
    }
}

function looksLikeMedia(url) {
    return /\.(mp4|webm|m4v|mov|m3u8|mpd|mkv|avi|flv|wmv)(\?|#|$)/i.test(url);
}
/* __PS_STORE_STRIP_END__ */

// Voice lists load asynchronously and are frequently empty on mobile
// Chromium until the engine warms up, so pick defensively and never hard-depend
// on a specific voice — fall back through en-US, any English, then whatever
// exists, and let the browser default if the list is still empty.
function pickVoice() {
  if (!('speechSynthesis' in window)) return null;
  const voices = speechSynthesis.getVoices();
  if (!voices || !voices.length) return null;
  return (
    voices.find(v => v.name && v.name.includes('Google US English')) ||
    voices.find(v => v.lang === 'en-US') ||
    voices.find(v => v.lang && v.lang.toLowerCase().startsWith('en')) ||
    voices[0]
  );
}
if ('speechSynthesis' in window) {
  speechSynthesis.onvoiceschanged = () => { ttsVoice = pickVoice(); };
  ttsVoice = pickVoice();
}
// Chromium's speech engine silently dies on utterances longer than ~15 seconds,
// so long text is split at sentence boundaries into short utterances and queued.
// The queue survives Stop (cancel flushes it) and each chunk restarts the timer.
function chunkText(text, max = 220) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const parts = clean.split(/(?<=[.!?…;:])\s+/);
  const chunks = [];
  let cur = '';
  for (const p of parts) {
    if (cur && cur.length + p.length + 1 > max) { chunks.push(cur); cur = p; }
    else cur = cur ? cur + ' ' + p : p;
    // A single run-on sentence can still exceed the cap — wrap it at a space.
    while (cur.length > max) {
      let cut = cur.lastIndexOf(' ', max);
      if (cut < max / 2) cut = max;
      chunks.push(cur.slice(0, cut));
      cur = cur.slice(cut).trim();
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}
function speak(text) {
  if (!('speechSynthesis' in window)) {
    showStatus('Speech synthesis is not available in this browser.', 3000);
    return;
  }
  try {
    speechSynthesis.cancel();
    const voice = ttsVoice || pickVoice();
    chunkText(text).forEach((chunk) => {
      const utterance = new SpeechSynthesisUtterance(chunk);
      utterance.rate = ttsRate;
      utterance.lang = (voice && voice.lang) || 'en-US';
      if (voice) utterance.voice = voice;
      utterance.onerror = (e) => {
        // Stop / a new read cancels the queue — that's not a failure.
        if (e && (e.error === 'canceled' || e.error === 'interrupted')) return;
        showStatus('Speech failed on this device.', 3000);
      };
      speechSynthesis.speak(utterance);
    });
  } catch (_) {
    showStatus('Speech failed to start.', 3000);
  }
}
function resolveBaseHost(hostname) {
    const parts = hostname.split('.').reverse();
    return parts.length > 2 ? `${parts[1]}.${parts[0]}` : hostname;
}
// chrome.tabs.query is promise-based on MV3 Chrome, but several mobile
// Chromium forks (Kiwi, older builds) ship the callback-only signature and
// throw synchronously when called WITHOUT a callback — which would reject the
// await below and leave the popup stuck on "Detecting site…". Passing a
// callback is accepted by both forms, so we always use the callback and wrap
// the result in a never-rejecting promise.
function queryTabs(query) {
    return new Promise((resolve) => {
        let done = false;
        const finish = (tabs) => { if (!done) { done = true; resolve(tabs || []); } };
        // Kiwi sometimes accepts the callback but never invokes it, which would
        // leave the promise (and the popup) hanging forever. Cap the wait so the
        // caller can fall back / retry instead of stalling on "Detecting site…".
        const timer = setTimeout(() => finish([]), 400);
        try {
            chrome.tabs.query(query, (tabs) => {
                clearTimeout(timer);
                void (chrome.runtime && chrome.runtime.lastError); // swallow, treat as empty
                finish(tabs);
            });
        } catch (_) {
            clearTimeout(timer);
            finish([]);
        }
    });
}
async function getActiveTab() {
    // Some forks don't match the popup's own window with currentWindow, so fall
    // back to lastFocusedWindow and finally an unscoped active-tab query.
    let tabs = await queryTabs({ active: true, currentWindow: true });
    if (!tabs.length) tabs = await queryTabs({ active: true, lastFocusedWindow: true });
    if (!tabs.length) tabs = await queryTabs({ active: true });
    return tabs[0];
}
// Cross-manifest script injection. MV3 (Chrome/Edge/Opera/Firefox) exposes
// chrome.scripting; MV2 (Kiwi and other Android Chromium forks) does not and
// uses chrome.tabs.executeScript instead. Both helpers normalize to a flat
// array of per-frame return values so call sites don't branch on the manifest.
function injectFunc(tabId, func, { allFrames = false } = {}) {
    if (chrome.scripting && chrome.scripting.executeScript) {
        return chrome.scripting
            .executeScript({ target: { tabId, allFrames }, func })
            .then((res) => (res || []).map((r) => r && r.result));
    }
    return new Promise((resolve, reject) => {
        // MV2 can't inject a function reference, so serialize and self-invoke it.
        chrome.tabs.executeScript(tabId, { code: `(${func.toString()})();`, allFrames }, (res) => {
            if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
            else resolve(res || []);
        });
    });
}
function injectFile(tabId, file) {
    if (chrome.scripting && chrome.scripting.executeScript) {
        return new Promise((resolve, reject) => {
            chrome.scripting.executeScript({ target: { tabId }, files: [file] }, () => {
                if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
                else resolve();
            });
        });
    }
    return new Promise((resolve, reject) => {
        chrome.tabs.executeScript(tabId, { file }, () => {
            if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
            else resolve();
        });
    });
}
function showStatus(text, timeout = 2000) {
    const statusEl = document.getElementById('status');
    statusEl.textContent = text;
    if (timeout) setTimeout(() => (statusEl.textContent = ''), timeout);
}
function loadHost(host) {
    activeHost = host;
    document.getElementById('domainInfo').textContent = `Detected site: ${host}`;
    chrome.storage.local.get([host, OFF_KEY], (res) => {
        document.getElementById('cssInput').value = res[host] || '';
        const toggle = document.getElementById('siteEnabled');
        if (toggle) toggle.checked = !((res[OFF_KEY] || {})[host]);
    });
    // Broadcast so decoupled modules (notepad) can reload their per-domain
    // state without popup.js needing to know about them.
    window.dispatchEvent(new CustomEvent('ps:hostchange', { detail: host }));
    reloadSnippets();
}
// Soft guard, not a parser. Confirms the input looks like CSS: at least one
// `selector { ... }` block, and that plain rule blocks carry a declaration.
// At-rules (@media/@keyframes/@font-face) nest braces, so their bodies are not
// declaration-checked; and a single declaration without a trailing `;`
// (e.g. `body{color:red}`) is accepted — both were wrongly rejected before.
function validateCss(css) {
    css = css.replace(/\/\*[\s\S]*?\*\//g, '').trim();
    const blockRegex = /[^\{\}]+\{[\s\S]*?\}/;
    if (!blockRegex.test(css)) {
        console.error('CSS does not contain any valid blocks.');
        return false;
    }
    // Trailing semicolon optional; skip property checks for blocks whose
    // selector starts with `@` (at-rules legitimately nest further braces).
    const propertyRegex = /([a-zA-Z-]+)\s*:\s*[^;{}]+;?/;
    const blockRe = /([^{}]*)\{([^{}]*)\}/g;
    let m;
    while ((m = blockRe.exec(css)) !== null) {
        const selector = m[1].trim();
        const body = m[2];
        if (selector.startsWith('@')) continue;
        if (body.trim() && !propertyRegex.test(body)) {
            console.error('Block contains invalid CSS properties:', m[0]);
            return false;
        }
    }
    return true;
}
function persistCss(css) {
    if (!activeHost) return;
    if (!css.trim()) {
        showStatus('Nothing to save — use Delete to remove this site\'s style.', 3000);
        return;
    }
    if (!validateCss(css)) {
        showStatus('Style is invalid, not saved.');
        return;
    }
    chrome.storage.local.set({ [activeHost]: css }, () => {
        showStatus('Saved!');
        reloadSnippets();
    });
}
function dropCss() {
    if (!activeHost) return;
    chrome.storage.local.remove([activeHost], () => {
        document.getElementById('cssInput').value = '';
        showStatus('Deleted for this site.');
        reloadSnippets();
        // A delete with nothing saved fires no storage change, so clear any
        // live preview explicitly (best-effort — page may have no script).
        getActiveTab().then((tab) => {
            if (tab && tab.id) {
                chrome.tabs.sendMessage(tab.id, { type: 'PS_PREVIEW', css: '' }, () => {
                    void (chrome.runtime && chrome.runtime.lastError);
                });
            }
        });
    });
}
// Flip the per-site on/off switch. The domain's CSS stays saved; content.js
// watches the reserved `__ps_off` map and applies the change live.
function setSiteEnabled(enabled) {
    if (!activeHost) return;
    chrome.storage.local.get(OFF_KEY, (r) => {
        const map = r[OFF_KEY] || {};
        if (enabled) delete map[activeHost];
        else map[activeHost] = true;
        chrome.storage.local.set({ [OFF_KEY]: map }, () => {
            showStatus(enabled ? 'Style enabled on this site.' : 'Style switched off on this site (kept saved).', 2500);
        });
    });
}
// Storage keys are bare domains holding CSS, EXCEPT internal keys namespaced
// under the reserved `__ps_` prefix (notes, UI state). Those must never appear
// as fake CSS snippets, so they're filtered out of the list here and out of
// the Export payload below.
function isReservedKey(k) {
    return k.startsWith('__ps_');
}
function renderSnippets(items) {
    const list = document.getElementById('list');
    list.innerHTML = '';
    const keys = Object.keys(items).filter((k) => !isReservedKey(k)).sort();
    if (!keys.length) {
        list.textContent = 'No saved snippets.';
        return;
    }
    keys.forEach((k) => {
        const div = document.createElement('div');
        div.className = 'kv';
        // Coerce defensively: a corrupt non-string value must not throw and
        // blank the whole list.
        const value = typeof items[k] === 'string' ? items[k] : String(items[k] ?? '');
        const preview = value.length > 200 ? value.slice(0, 200) + '…' : value;
        // Built with DOM APIs / textContent rather than innerHTML so storage
        // keys (domains) and snippet bodies can never be parsed as markup.
        const title = document.createElement('strong');
        title.textContent = k;
        const body = document.createElement('div');
        body.className = 'small';
        body.textContent = preview;
        div.appendChild(title);
        div.appendChild(body);
        div.addEventListener('click', () => {
            document.getElementById('cssInput').value = value;
            showStatus(`Loaded ${k} into editor`, 1500);
        });
        list.appendChild(div);
    });
}
function reloadSnippets() {
    chrome.storage.local.get(null, renderSnippets);
}
async function pollActiveTab() {
    try {
        const tab = await getActiveTab();
        if (!tab || !tab.url) return;
        const host = resolveBaseHost(new URL(tab.url).hostname);
        if (host !== activeHost) loadHost(host);
    } catch (_) { /* leave current state intact */ }
}
// Reserved key the content script writes with the foreground page's host. It's
// the fallback when chrome.tabs.query is unreliable (Kiwi), since the page
// itself always knows its own hostname.
const LASTHOST_KEY = '__ps_lasthost';
function hostFromTab(tab) {
    if (!tab || !tab.url) return null;
    try { return resolveBaseHost(new URL(tab.url).hostname); } catch (_) { return null; }
}
function readLastHost() {
    return new Promise((resolve) => {
        try { chrome.storage.local.get(LASTHOST_KEY, (r) => resolve((r && r[LASTHOST_KEY]) || null)); }
        catch (_) { resolve(null); }
    });
}
// Detect the active site, retrying because some mobile Chromium forks (Kiwi)
// return no active tab for a beat after the popup opens — or never answer the
// query at all. Falls back to the host the content script last recorded so the
// site is still detected when tabs.query is broken. Returns true on success.
async function detectActiveHost({ retries = 4, delay = 300 } = {}) {
    for (let i = 0; i < retries; i++) {
        // Prefer the live tab query (accurate across windows); the moment it
        // comes up empty, fall back to the content script's recorded host so a
        // broken tabs.query doesn't strand us on "Detecting site…".
        const host = hostFromTab(await getActiveTab());
        if (host) { loadHost(host); return true; }
        const fallback = await readLastHost();
        if (fallback) { loadHost(fallback); return true; }
        await new Promise((r) => setTimeout(r, delay));
    }
    return false;
}

/* __PS_STORE_STRIP_START__ — media scanner / downloader (not in store build) */
async function collectMediaSources() {
    const tab = await getActiveTab();
    if (!tab || !tab.id) {
        showStatus('No active tab detected.');
        return [];
    }

    let results;
    try {
        results = await injectFunc(tab.id, () => {
            const candidates = [];
            const seen = new Set();

            function addCandidate(url, source, extra = {}) {
                if (!url || typeof url !== 'string') return;
                const trimmed = url.trim();
                if (!trimmed) return;
                if (seen.has(trimmed)) return;
                seen.add(trimmed);
                candidates.push({
                    url: trimmed,
                    source,
                    ...extra
                });
            }

            const videos = Array.from(document.querySelectorAll('video'));
            videos.forEach((video, index) => {
                addCandidate(video.currentSrc, 'video.currentSrc', {
                    muted: video.muted,
                    title: video.title || document.title || '',
                    index
                });
                addCandidate(video.src, 'video.src', {
                    muted: video.muted,
                    title: video.title || document.title || '',
                    index
                });
                Array.from(video.querySelectorAll('source')).forEach((source) => {
                    addCandidate(source.src, 'video source tag', {
                        type: source.type || ''
                    });
                });
            });

            const links = Array.from(document.querySelectorAll('a[href]'));
            links.forEach((a) => {
                const href = a.getAttribute('href') || '';
                if (/\.(mp4|webm|m4v|mov|m3u8|mpd)(\?|#|$)/i.test(href)) {
                    addCandidate(a.href, 'media link', {
                        filenameHint: (a.textContent || '').trim().slice(0, 80)
                    });
                }
            });

            const perf = performance.getEntriesByType
                ? performance.getEntriesByType('resource')
                : [];
            perf.forEach((entry) => {
                if (entry && entry.name && /\.(mp4|webm|m4v|mov|m3u8|mpd)(\?|#|$)/i.test(entry.name)) {
                    addCandidate(entry.name, 'network resource', {
                        initiatorType: entry.initiatorType || ''
                    });
                }
            });

            return candidates;
        }, { allFrames: true });
    } catch (err) {
        showStatus(`Cannot scan this page: ${err?.message || err}`, 3000);
        return [];
    }

    const merged = [];
    const dedup = new Set();
    (results || []).forEach((frameCandidates) => {
        const list = Array.isArray(frameCandidates) ? frameCandidates : [];
        list.forEach((candidate) => {
            const normalizedUrl = normalizeUrl(candidate?.url);
            if (!normalizedUrl || dedup.has(normalizedUrl)) return;
            dedup.add(normalizedUrl);
            merged.push({
                ...candidate,
                url: normalizedUrl,
                downloadable: !normalizedUrl.startsWith('blob:'),
                likelyMediaFile: looksLikeMedia(normalizedUrl)
            });
        });
    });

    merged.sort((a, b) => {
        if (a.downloadable !== b.downloadable) return a.downloadable ? -1 : 1;
        if (a.likelyMediaFile !== b.likelyMediaFile) return a.likelyMediaFile ? -1 : 1;
        return a.url.length - b.url.length;
    });

    return merged;
}

function downloadCandidate(candidate) {
    if (!candidate || !candidate.downloadable) {
        showStatus('That media is a blob stream and cannot be downloaded directly.', 3500);
        return;
    }
    chrome.downloads.download({
        url: candidate.url,
        conflictAction: 'uniquify'
    }, (downloadId) => {
        if (chrome.runtime.lastError || !downloadId) {
            showStatus(`Download failed: ${chrome.runtime.lastError?.message || 'Unknown error'}`, 3000);
            return;
        }
        showStatus('Video download started.', 3000);
    });
}

// Renders the found media as an in-popup tappable list. prompt() is unreliable
// inside mobile extension popups, so each candidate is a real button instead.
function renderMediaCandidates(list) {
    const container = document.getElementById('mediaList');
    if (!container) return;
    container.innerHTML = '';
    if (!list.length) {
        container.textContent = 'No video media found on this page.';
        return;
    }
    list.forEach((candidate, i) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'media-item';
        const quality = candidate.qualityLabel ? ` (${candidate.qualityLabel})` : '';
        const title = document.createElement('span');
        title.className = 'media-title';
        title.textContent = `${i + 1}. ${candidate.source || 'media'}${quality}`;
        const urlEl = document.createElement('span');
        urlEl.className = 'small';
        urlEl.textContent = candidate.url;
        btn.appendChild(title);
        btn.appendChild(urlEl);
        if (!candidate.downloadable) {
            btn.disabled = true;
            btn.title = 'Blob stream — cannot be downloaded directly';
        } else {
            btn.addEventListener('click', () => downloadCandidate(candidate));
        }
        container.appendChild(btn);
    });
}
/* __PS_STORE_STRIP_END__ */

// Send a message to the tab's content script, injecting content.js once and
// retrying when the registered instance isn't reachable (e.g. the page was
// open before the extension was installed/reloaded). Shared by the inspect
// picker and the live-preview flow.
function messageTab(tabId, msg) {
    return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, msg, (resp) => {
            if (!chrome.runtime.lastError && resp) {
                resolve(resp);
                return;
            }
            injectFile(tabId, 'content.js').then(() => {
                chrome.tabs.sendMessage(tabId, msg, (resp2) => {
                    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message || 'Page not reachable'));
                    else resolve(resp2);
                });
            }).catch(reject);
        });
    });
}

// Live preview: push the editor's CSS onto the page without saving. It stays
// until the next Save / Delete or a page reload.
async function previewCss() {
    const tab = await getActiveTab();
    if (!tab || !tab.id) {
        showStatus('No active tab detected.', 2500);
        return;
    }
    const css = document.getElementById('cssInput').value;
    try {
        await messageTab(tab.id, { type: 'PS_PREVIEW', css });
        showStatus(css.trim() ? 'Previewing — Save to keep, reload to discard.' : 'Preview cleared.', 3000);
    } catch (_) {
        showStatus('Cannot preview on this page.', 3000);
    }
}

/* __PS_STORE_STRIP_START__ — screenshot capture (not in store build) */
// One-tap screenshot of the visible tab, saved through the native download
// manager. Needs no extra permission: activeTab / <all_urls> already cover
// captureVisibleTab, and downloads is held for the media saver.
function captureScreenshot() {
    if (!(chrome.tabs && typeof chrome.tabs.captureVisibleTab === 'function')) {
        showStatus('Screenshots are not supported in this browser.', 3000);
        return;
    }
    chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
        if (chrome.runtime.lastError || !dataUrl) {
            showStatus(`Screenshot failed: ${chrome.runtime.lastError?.message || 'no image returned'}`, 3000);
            return;
        }
        const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
        chrome.downloads.download({
            url: dataUrl,
            filename: `pageside-${activeHost || 'page'}-${stamp}.png`,
            conflictAction: 'uniquify'
        }, (downloadId) => {
            if (chrome.runtime.lastError || !downloadId) {
                showStatus(`Screenshot failed: ${chrome.runtime.lastError?.message || 'download rejected'}`, 3000);
            } else {
                showStatus('Screenshot saved to downloads.', 2500);
            }
        });
    });
}
/* __PS_STORE_STRIP_END__ */

// Starting-point CSS templates appended into the editor (never auto-saved) —
// the user tunes the selectors per site, then Previews / Saves.
const CSS_PRESETS = {
    dark: `/* Dark mode (invert-based) */
html { filter: invert(0.92) hue-rotate(180deg); background: #0d0d0d !important; }
img, picture, video, canvas, iframe, svg { filter: invert(1) hue-rotate(180deg); }`,
    nosticky: `/* Hide sticky bars & cookie prompts — tune the selectors per site */
[class*="cookie"], [id*="cookie"], [class*="consent"], [id*="consent"],
[class*="newsletter"], [class*="paywall"] { display: none !important; }
body { overflow: auto !important; position: static !important; }`,
    readable: `/* Readable text */
body { font-family: Georgia, 'Times New Roman', serif !important; line-height: 1.65 !important; }
p { max-width: 70ch; }`,
    bigtext: `/* Bigger text */
html { font-size: 120% !important; }`
};

// Import a previously exported JSON backup. Only domain-shaped keys with
// string values are accepted; reserved `__ps_` keys and anything else are
// skipped so a crafted file can't overwrite internal state.
function importSnippets(file) {
    const reader = new FileReader();
    reader.onload = () => {
        let data;
        try {
            data = JSON.parse(String(reader.result));
        } catch (_) {
            showStatus('Import failed: not valid JSON.', 3000);
            return;
        }
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            showStatus('Import failed: expected an object of domain → CSS.', 3000);
            return;
        }
        const valid = {};
        let skipped = 0;
        Object.keys(data).forEach((k) => {
            const domainish = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(k);
            if (isReservedKey(k) || !domainish || typeof data[k] !== 'string') { skipped++; return; }
            valid[k] = data[k];
        });
        const count = Object.keys(valid).length;
        if (!count) {
            showStatus('Import: no valid snippets found in that file.', 3000);
            return;
        }
        chrome.storage.local.set(valid, () => {
            showStatus(`Imported ${count} snippet${count === 1 ? '' : 's'}${skipped ? `, skipped ${skipped} entr${skipped === 1 ? 'y' : 'ies'}` : ''}.`, 3000);
            reloadSnippets();
            if (activeHost && typeof valid[activeHost] === 'string') {
                document.getElementById('cssInput').value = valid[activeHost];
            }
        });
    };
    reader.onerror = () => showStatus('Import failed: could not read the file.', 3000);
    reader.readAsText(file);
}

/* __PS_STORE_STRIP_START__ — media scan entry point (not in store build) */
async function pickAndSaveMedia() {
    showStatus('Scanning page for video media…', 1500);
    const mediaUrls = await collectMediaSources();
    mediaCandidates = mediaUrls;
    renderMediaCandidates(mediaUrls);
    if (mediaUrls.length) {
        showStatus(`Found ${mediaUrls.length} media source(s). Tap one to download.`, 3000);
    }
}
/* __PS_STORE_STRIP_END__ */
// React to tab switches/navigations instantly where the events fire; the
// interval poll below stays as a low-frequency fallback for environments
// (some mobile Chromium builds) where these events are unreliable.
if (chrome.tabs && chrome.tabs.onActivated) {
    chrome.tabs.onActivated.addListener(() => pollActiveTab());
}
if (chrome.tabs && chrome.tabs.onUpdated) {
    chrome.tabs.onUpdated.addListener((_id, info, tab) => {
        if (info.url && tab && tab.active) pollActiveTab();
    });
}
// When tabs.query is unreliable (Kiwi), the content script's recorded
// foreground host is the most reliable signal — follow it as it changes.
if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes[LASTHOST_KEY]) return;
        const h = changes[LASTHOST_KEY].newValue;
        if (h && h !== activeHost) loadHost(h);
    });
}
document.addEventListener('DOMContentLoaded', async () => {
    const cssInput = document.getElementById('cssInput');
    const saveBtn = document.getElementById('saveBtn');
    const deleteBtn = document.getElementById('deleteBtn');
    const refreshBtn = document.getElementById('refreshBtn');
    const exportBtn = document.getElementById('exportBtn');
    const domainInfo = document.getElementById('domainInfo');
    const runDetect = () => {
        domainInfo.textContent = 'Detecting site…';
        detectActiveHost().then((ok) => {
            if (!ok) {
                domainInfo.textContent = 'Could not detect the site — tap to retry.';
                domainInfo.style.cursor = 'pointer';
            }
        });
    };
    domainInfo.addEventListener('click', () => { if (!activeHost) runDetect(); });
    runDetect();
    saveBtn.addEventListener('click', () => persistCss(cssInput.value));
    deleteBtn.addEventListener('click', dropCss);
    refreshBtn.addEventListener('click', reloadSnippets);
    /* __PS_STORE_STRIP_START__ — Capture/Media button wiring (not in store build) */
    const downloadVideoBtn = document.getElementById('downloadVideoBtn');
    if (downloadVideoBtn) {
        downloadVideoBtn.addEventListener('click', pickAndSaveMedia);
    }
    const screenshotBtn = document.getElementById('screenshotBtn');
    if (screenshotBtn) screenshotBtn.addEventListener('click', captureScreenshot);
    /* __PS_STORE_STRIP_END__ */
    const previewBtn = document.getElementById('previewBtn');
    if (previewBtn) previewBtn.addEventListener('click', previewCss);
    const siteEnabled = document.getElementById('siteEnabled');
    if (siteEnabled) siteEnabled.addEventListener('change', () => setSiteEnabled(siteEnabled.checked));
    document.querySelectorAll('button.preset').forEach((btn) => {
        btn.addEventListener('click', () => {
            const css = CSS_PRESETS[btn.dataset.preset];
            if (!css) return;
            cssInput.value = (cssInput.value.trim() ? cssInput.value.replace(/\s*$/, '\n\n') : '') + css + '\n';
            showStatus('Preset added to the editor — Preview or Save to apply.', 2500);
        });
    });
    const importBtn = document.getElementById('importBtn');
    const importFile = document.getElementById('importFile');
    if (importBtn && importFile) {
        importBtn.addEventListener('click', () => importFile.click());
        importFile.addEventListener('change', () => {
            const file = importFile.files && importFile.files[0];
            importFile.value = ''; // allow re-picking the same file
            if (file) importSnippets(file);
        });
    }
    exportBtn.addEventListener('click', () => {
        chrome.storage.local.get(null, (items) => {
            // Export CSS snippets only — never the reserved `__ps_` keys, so
            // private notes / UI state don't leak into a shared backup.
            const snippets = {};
            Object.keys(items).forEach((k) => {
                if (!isReservedKey(k)) snippets[k] = items[k];
            });
            const data = JSON.stringify(snippets, null, 2);
            const blob = new Blob([data], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'pageside-snippets.json';
            a.click();
            // Defer revoke so slower mobile builds keep the blob URL alive
            // long enough to start the download.
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            showStatus('Exported JSON.');
        });
    });
    reloadSnippets();
});
document.addEventListener('DOMContentLoaded', () => {
  // mode 'copy' (default) copies the tapped element's selector; mode 'hide'
  // appends a display:none rule to the site's saved CSS and hides it live.
  function startPick(tabId, mode) {
    messageTab(tabId, { type: 'PS_START_PICK', mode })
      .then(() => window.close())
      .catch(() => showStatus('Cannot inspect this page.', 3000));
  }
  const inspectBtn = document.getElementById('inspectBtn');
  if (inspectBtn) {
    inspectBtn.addEventListener('click', async () => {
      const tab = await getActiveTab();
      if (tab && tab.id) startPick(tab.id);
      else showStatus('No active tab detected.', 2500);
    });
  }
  const hideBtn = document.getElementById('hideBtn');
  if (hideBtn) {
    hideBtn.addEventListener('click', async () => {
      const tab = await getActiveTab();
      if (tab && tab.id) startPick(tab.id, 'hide');
      else showStatus('No active tab detected.', 2500);
    });
  }
  const readTextBtn = document.getElementById('readTextBtn');
  if (readTextBtn) {
    readTextBtn.addEventListener('click', async () => {
      // Ask the content script for the selected text
      const tab = await getActiveTab();
      if (!tab || !tab.id) {
        showStatus('No active tab detected.', 2500);
        return;
      }
      injectFunc(tab.id, () => window.getSelection().toString())
        .then((results) => {
          const selectedText = results && results[0];
          if (selectedText && selectedText.trim() !== '') {
            speak(selectedText);
          } else {
            showStatus('No text selected on the page.', 2500);
          }
        })
        .catch((err) => showStatus(`Cannot read this page: ${err.message || err}`, 3000));
    });
  }
  const readPageBtn = document.getElementById('readPageBtn');
  if (readPageBtn) {
    readPageBtn.addEventListener('click', async () => {
      const tab = await getActiveTab();
      if (!tab || !tab.id) {
        showStatus('No active tab detected.', 2500);
        return;
      }
      // Prefer the page's main-content landmark so navigation chrome, menus,
      // and footers aren't read out; cap the text so a huge page can't wedge
      // the speech queue.
      injectFunc(tab.id, () => {
        const el = document.querySelector('article') ||
          document.querySelector('main') ||
          document.querySelector('[role="main"]') ||
          document.body;
        return el ? (el.innerText || '').slice(0, 60000) : '';
      })
        .then((results) => {
          const text = results && results[0];
          if (text && text.trim()) {
            speak(text);
            showStatus('Reading the page — tap Stop to end.', 2500);
          } else {
            showStatus('No readable text found on this page.', 2500);
          }
        })
        .catch((err) => showStatus(`Cannot read this page: ${err.message || err}`, 3000));
    });
  }
  const ttsRateEl = document.getElementById('ttsRate');
  if (ttsRateEl) {
    ttsRateEl.addEventListener('input', () => {
      ttsRate = parseFloat(ttsRateEl.value) || 1;
      const v = document.getElementById('ttsRateVal');
      if (v) v.textContent = ttsRate.toFixed(1) + '×';
    });
  }
  const stopReadBtn = document.getElementById('stopReadBtn');
  if (stopReadBtn) {
    stopReadBtn.addEventListener('click', () => {
      // Immediately stop any ongoing speech (and flush the chunk queue).
      if ('speechSynthesis' in window) speechSynthesis.cancel();
    });
  }
});
setInterval(pollActiveTab, 1000);
