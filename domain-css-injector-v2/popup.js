let currentDomain = null;
let englishVoice;
let videoCandidates = [];

function normalizeMediaUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return null;
    const trimmed = rawUrl.trim();
    if (!trimmed) return null;
    try {
        return new URL(trimmed, window.location.href).href;
    } catch (_) {
        return null;
    }
}

function isLikelyMediaUrl(url) {
    return /\.(mp4|webm|m4v|mov|m3u8|mpd|mkv|avi|flv|wmv)(\?|#|$)/i.test(url);
}

function getMediaLabel(candidate, index) {
    const source = candidate.source || 'unknown';
    const quality = candidate.qualityLabel ? ` (${candidate.qualityLabel})` : '';
    const fileHint = candidate.filenameHint ? ` [${candidate.filenameHint}]` : '';
    return `${index + 1}. ${source}${quality}${fileHint}\n${candidate.url}`;
}

speechSynthesis.onvoiceschanged = () => {
  const voices = speechSynthesis.getVoices();
  englishVoice =
    voices.find(v => v.name.includes('Google US English')) ||
    voices.find(v => v.lang === 'en-US');
};
function getBaseDomain(hostname) {
    const parts = hostname.split('.').reverse();
    return parts.length > 2 ? `${parts[1]}.${parts[0]}` : hostname;
}
async function queryActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs && tabs[0];
}
function setStatus(text, timeout = 2000) {
    const statusEl = document.getElementById('status');
    statusEl.textContent = text;
    if (timeout) setTimeout(() => (statusEl.textContent = ''), timeout);
}
function refreshDomain(domain) {
    currentDomain = domain;
    document.getElementById('domainInfo').textContent = `Detected domain: ${domain}`;
    chrome.storage.local.get([domain], (res) => {
        document.getElementById('cssInput').value = res[domain] || '';
    });
    refreshList();
}
function isValidCSS(css) {
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
function saveCSS(css) {
    if (!currentDomain) return;
    if (!isValidCSS(css)) {
        setStatus('CSS is invalid, not saved.');
        return;
    }
    chrome.storage.local.set({ [currentDomain]: css }, () => {
        setStatus('Saved!');
        refreshList();
    });
}
function deleteCSS() {
    if (!currentDomain) return;
    chrome.storage.local.remove([currentDomain], () => {
        document.getElementById('cssInput').value = '';
        setStatus('Deleted for this domain.');
        refreshList();
    });
}
function renderList(items) {
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
            setStatus(`Loaded ${k} into editor`, 1500);
        });
        list.appendChild(div);
    });
}
function refreshList() {
    chrome.storage.local.get(null, renderList);
}
async function updateActiveTab() {
    const tab = await queryActiveTab();
    if (!tab || !tab.url) return;
    const domain = getBaseDomain(new URL(tab.url).hostname);
    if (domain !== currentDomain) refreshDomain(domain);
}

async function fetchVideoSourcesFromActiveTab() {
    const tab = await queryActiveTab();
    if (!tab || !tab.id) {
        setStatus('No active tab detected.');
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
            const normalizedUrl = normalizeMediaUrl(candidate?.url);
            if (!normalizedUrl || dedup.has(normalizedUrl)) return;
            dedup.add(normalizedUrl);
            merged.push({
                ...candidate,
                url: normalizedUrl,
                downloadable: !normalizedUrl.startsWith('blob:'),
                likelyMediaFile: isLikelyMediaUrl(normalizedUrl)
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

async function chooseAndDownloadVideo() {
    const mediaUrls = await fetchVideoSourcesFromActiveTab();
    videoCandidates = mediaUrls;
    if (!mediaUrls.length) {
        setStatus('No video media found on this page.');
        return;
    }

    const options = mediaUrls
        .map((candidate, i) => getMediaLabel(candidate, i))
        .join('\n');

    const selection = prompt(`Select video to download:

${options}

Enter number:`);
    const selectionNumber = Number(selection);

    if (!selection || Number.isNaN(selectionNumber) || selectionNumber < 1 || selectionNumber > mediaUrls.length) {
        setStatus('Download cancelled.');
        return;
    }

    const selected = mediaUrls[selectionNumber - 1];
    if (!selected.downloadable) {
        setStatus('Selected media is a blob stream and cannot be downloaded directly.', 3500);
        return;
    }

    const selectedUrl = selected.url;
    chrome.downloads.download({
        url: selectedUrl,
        conflictAction: 'uniquify'
    }, (downloadId) => {
        if (chrome.runtime.lastError || !downloadId) {
            setStatus(`Download failed: ${chrome.runtime.lastError?.message || 'Unknown error'}`, 3000);
            return;
        }
        setStatus('Video download started.', 3000);
    });
}
chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'TAB_CHANGED' && msg.domain && msg.domain !== currentDomain) {
        refreshDomain(msg.domain);
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
    const tab = await queryActiveTab();
    if (tab && tab.url) {
        refreshDomain(getBaseDomain(new URL(tab.url).hostname));
    } else {
        document.getElementById('domainInfo').textContent = 'No active tab detected.';
    }
    saveBtn.addEventListener('click', () => saveCSS(cssInput.value));
    deleteBtn.addEventListener('click', deleteCSS);
    refreshBtn.addEventListener('click', refreshList);
    if (downloadVideoBtn) {
        downloadVideoBtn.addEventListener('click', chooseAndDownloadVideo);
    }
    exportBtn.addEventListener('click', () => {
        chrome.storage.local.get(null, (items) => {
            const data = JSON.stringify(items, null, 2);
            const blob = new Blob([data], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'domain-css-snippets.json';
            a.click();
            URL.revokeObjectURL(url);
            setStatus('Exported JSON.');
        });
    });
    refreshList();
});
document.addEventListener('DOMContentLoaded', () => {
  const inspectBtn = document.getElementById('inspectBtn');
  if (inspectBtn) {
    inspectBtn.addEventListener('click', () => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, { type: 'START_INSPECT' });
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
				if (englishVoice) utterance.voice = englishVoice;
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
setInterval(updateActiveTab, 500);
