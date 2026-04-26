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

function formatCandidate(candidate, index) {
    const source = candidate.source || 'unknown';
    const quality = candidate.qualityLabel ? ` (${candidate.qualityLabel})` : '';
    const fileHint = candidate.filenameHint ? ` [${candidate.filenameHint}]` : '';
    return `${index + 1}. ${source}${quality}${fileHint}\n${candidate.url}`;
}

speechSynthesis.onvoiceschanged = () => {
  const voices = speechSynthesis.getVoices();
  ttsVoice =
    voices.find(v => v.name.includes('Google US English')) ||
    voices.find(v => v.lang === 'en-US');
};
function resolveBaseHost(hostname) {
    const parts = hostname.split('.').reverse();
    return parts.length > 2 ? `${parts[1]}.${parts[0]}` : hostname;
}
async function getActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs && tabs[0];
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
    reloadSnippets();
}
function validateCss(css) {
    css = css.replace(/\/\*[\s\S]*?\*\//g, '').trim();
    const blockRegex = /[^\{\}]+\{[^\{\}]*\}/;
    if (!blockRegex.test(css)) {
        console.error('CSS does not contain any valid blocks.');
        return false;
    }
    const propertyRegex = /([a-zA-Z-]+)\s*:\s*[^;]+;/;
    const blocks = css.match(/\{([^\{\}]*)\}/g) || [];
    for (let block of blocks) {
        if (!propertyRegex.test(block)) {
            console.error('Block contains invalid CSS properties:', block);
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
function renderSnippets(items) {
    const list = document.getElementById('list');
    list.innerHTML = '';
    const keys = Object.keys(items).sort();
    if (!keys.length) {
        list.textContent = 'No saved snippets.';
        return;
    }
    keys.forEach((k) => {
        const div = document.createElement('div');
        div.className = 'kv';
        const preview = items[k].length > 200 ? items[k].slice(0, 200) + '…' : items[k];
        div.innerHTML = `<strong>${k}</strong><div class="small">${preview}</div>`;
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
    const tab = await getActiveTab();
    if (!tab || !tab.url) return;
    const host = resolveBaseHost(new URL(tab.url).hostname);
    if (host !== activeHost) loadHost(host);
}

async function collectMediaSources() {
    const tab = await getActiveTab();
    if (!tab || !tab.id) {
        showStatus('No active tab detected.');
        return [];
    }

    const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        allFrames: true,
        func: () => {
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
        }
    });

    const merged = [];
    const dedup = new Set();
    (results || []).forEach((frameResult) => {
        const frameCandidates = Array.isArray(frameResult?.result) ? frameResult.result : [];
        frameCandidates.forEach((candidate) => {
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

async function pickAndSaveMedia() {
    const mediaUrls = await collectMediaSources();
    mediaCandidates = mediaUrls;
    if (!mediaUrls.length) {
        showStatus('No video media found on this page.');
        return;
    }

    const options = mediaUrls
        .map((candidate, i) => formatCandidate(candidate, i))
        .join('\n');

    const selection = prompt(`Select video to download:

${options}

Enter number:`);
    const selectionNumber = Number(selection);

    if (!selection || Number.isNaN(selectionNumber) || selectionNumber < 1 || selectionNumber > mediaUrls.length) {
        showStatus('Download cancelled.');
        return;
    }

    const selected = mediaUrls[selectionNumber - 1];
    if (!selected.downloadable) {
        showStatus('Selected media is a blob stream and cannot be downloaded directly.', 3500);
        return;
    }

    const selectedUrl = selected.url;
    chrome.downloads.download({
        url: selectedUrl,
        conflictAction: 'uniquify'
    }, (downloadId) => {
        if (chrome.runtime.lastError || !downloadId) {
            showStatus(`Download failed: ${chrome.runtime.lastError?.message || 'Unknown error'}`, 3000);
            return;
        }
        showStatus('Video download started.', 3000);
    });
}
chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'TAB_CHANGED' && msg.domain && msg.domain !== activeHost) {
        loadHost(msg.domain);
    }
});
document.addEventListener('DOMContentLoaded', async () => {
    const cssInput = document.getElementById('cssInput');
    const saveBtn = document.getElementById('saveBtn');
    const deleteBtn = document.getElementById('deleteBtn');
    const refreshBtn = document.getElementById('refreshBtn');
    const exportBtn = document.getElementById('exportBtn');
    const clearAllBtn = document.getElementById('clearAllBtn');
    const downloadVideoBtn = document.getElementById('downloadVideoBtn');
    const tab = await getActiveTab();
    if (tab && tab.url) {
        loadHost(resolveBaseHost(new URL(tab.url).hostname));
    } else {
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
            const data = JSON.stringify(items, null, 2);
            const blob = new Blob([data], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'pageside-snippets.json';
            a.click();
            URL.revokeObjectURL(url);
            showStatus('Exported JSON.');
        });
    });
    reloadSnippets();
});
document.addEventListener('DOMContentLoaded', () => {
  const inspectBtn = document.getElementById('inspectBtn');
  if (inspectBtn) {
    inspectBtn.addEventListener('click', () => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, { type: 'PS_START_PICK' });
        }
      });
    });
  }
  const readTextBtn = document.getElementById('readTextBtn');
  if (readTextBtn) {
    readTextBtn.addEventListener('click', () => {
      // Ask the content script for the selected text
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.scripting.executeScript(
            {
              target: { tabId: tabs[0].id },
              func: () => window.getSelection().toString()
            },
            (results) => {
              const selectedText = results && results[0] && results[0].result;
              if (selectedText && selectedText.trim() !== '') {
                // Speak the selected text
                const utterance = new SpeechSynthesisUtterance(selectedText);
				utterance.lang = 'en-US';
				if (ttsVoice) utterance.voice = ttsVoice;
				speechSynthesis.speak(utterance);
              } else {
                alert('No text selected on the page.');
              }
            }
          );
        }
      });
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
setInterval(pollActiveTab, 500);
