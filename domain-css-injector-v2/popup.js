let activeHost = null;
let ttsVoice;
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
function speak(text) {
  if (!('speechSynthesis' in window)) {
    showStatus('Speech synthesis is not available in this browser.', 3000);
    return;
  }
  try {
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    const voice = ttsVoice || pickVoice();
    if (voice) utterance.voice = voice;
    utterance.onerror = () => showStatus('Speech failed on this device.', 3000);
    speechSynthesis.speak(utterance);
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
        try {
            chrome.tabs.query(query, (tabs) => {
                void (chrome.runtime && chrome.runtime.lastError); // swallow, treat as empty
                resolve(tabs || []);
            });
        } catch (_) {
            resolve([]);
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
    chrome.storage.local.get([host], (res) => {
        document.getElementById('cssInput').value = res[host] || '';
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
        const preview = items[k].length > 200 ? items[k].slice(0, 200) + '…' : items[k];
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
            document.getElementById('cssInput').value = items[k];
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

            if (window.ytInitialPlayerResponse && window.ytInitialPlayerResponse.streamingData) {
                const { formats = [], adaptiveFormats = [] } = window.ytInitialPlayerResponse.streamingData;
                [...formats, ...adaptiveFormats].forEach((fmt) => {
                    addCandidate(fmt.url, 'YouTube stream', {
                        qualityLabel: fmt.qualityLabel || '',
                        mimeType: fmt.mimeType || ''
                    });
                });
            }

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

async function pickAndSaveMedia() {
    showStatus('Scanning page for video media…', 1500);
    const mediaUrls = await collectMediaSources();
    mediaCandidates = mediaUrls;
    renderMediaCandidates(mediaUrls);
    if (mediaUrls.length) {
        showStatus(`Found ${mediaUrls.length} media source(s). Tap one to download.`, 3000);
    }
}
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
document.addEventListener('DOMContentLoaded', async () => {
    const cssInput = document.getElementById('cssInput');
    const saveBtn = document.getElementById('saveBtn');
    const deleteBtn = document.getElementById('deleteBtn');
    const refreshBtn = document.getElementById('refreshBtn');
    const exportBtn = document.getElementById('exportBtn');
    const downloadVideoBtn = document.getElementById('downloadVideoBtn');
    try {
        const tab = await getActiveTab();
        if (tab && tab.url) {
            loadHost(resolveBaseHost(new URL(tab.url).hostname));
        } else {
            document.getElementById('domainInfo').textContent = 'No active tab detected.';
        }
    } catch (_) {
        document.getElementById('domainInfo').textContent = 'No active tab detected.';
    }
    saveBtn.addEventListener('click', () => persistCss(cssInput.value));
    deleteBtn.addEventListener('click', dropCss);
    refreshBtn.addEventListener('click', reloadSnippets);
    if (downloadVideoBtn) {
        downloadVideoBtn.addEventListener('click', pickAndSaveMedia);
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
  function startPick(tabId) {
    chrome.tabs.sendMessage(tabId, { type: 'PS_START_PICK' }, (resp) => {
      if (!chrome.runtime.lastError && resp) {
        window.close();
        return;
      }
      // The registered content script isn't reachable (e.g. the page was open
      // before the extension was installed/reloaded). Inject it once, then retry.
      injectFile(tabId, 'content.js').then(() => {
        chrome.tabs.sendMessage(tabId, { type: 'PS_START_PICK' }, () => {
          if (chrome.runtime.lastError) {
            showStatus('Cannot inspect this page.', 3000);
          } else {
            window.close();
          }
        });
      }).catch(() => showStatus('Cannot inspect this page.', 3000));
    });
  }
  const inspectBtn = document.getElementById('inspectBtn');
  if (inspectBtn) {
    inspectBtn.addEventListener('click', async () => {
      const tab = await getActiveTab();
      if (tab && tab.id) startPick(tab.id);
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
  const stopReadBtn = document.getElementById('stopReadBtn');
  if (stopReadBtn) {
  stopReadBtn.addEventListener('click', () => {
    // Immediately stop any ongoing speech:
    speechSynthesis.cancel();
    });
  }
});
setInterval(pollActiveTab, 1000);
