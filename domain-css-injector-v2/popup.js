let currentDomain = null;
let englishVoice;
let videoCandidates = [];

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
        func: () => {
            const urls = new Set();
            const videos = Array.from(document.querySelectorAll('video'));

            videos.forEach((video) => {
                if (video.currentSrc) urls.add(video.currentSrc);
                if (video.src) urls.add(video.src);
                Array.from(video.querySelectorAll('source')).forEach((source) => {
                    if (source.src) urls.add(source.src);
                });
            });

            return Array.from(urls).filter(Boolean);
        }
    });

    const mediaUrls = results && results[0] && Array.isArray(results[0].result)
        ? results[0].result
        : [];

    return mediaUrls;
}

async function chooseAndDownloadVideo() {
    const mediaUrls = await fetchVideoSourcesFromActiveTab();
    if (!mediaUrls.length) {
        setStatus('No video media found on this page.');
        return;
    }

    const options = mediaUrls
        .map((url, i) => `${i + 1}. ${url}`)
        .join('\n');

    const selection = prompt(`Select video to download:

${options}

Enter number:`);
    const selectionNumber = Number(selection);

    if (!selection || Number.isNaN(selectionNumber) || selectionNumber < 1 || selectionNumber > mediaUrls.length) {
        setStatus('Download cancelled.');
        return;
    }

    const selectedUrl = mediaUrls[selectionNumber - 1];
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