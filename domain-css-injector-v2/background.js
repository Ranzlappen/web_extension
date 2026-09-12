// Background worker (MV3 service worker / MV2 event page). Its main job is
// executing the page hotkeys: content.js matches the keystroke but cannot reach
// the chrome.tabs API, so it posts the ACTION here and this file mutes tabs,
// fans volume steps out to the tab's frames, and starts the element picker.
//
// The fenced region below is the second job — the right-click media entry — and
// is removed from the Chrome Web Store build by tools/build-store-package.mjs,
// which ships the hotkey router alone.

/* __PS_STORE_STRIP_START__ — context menu "Download this video" (not in the
   store build). Registers the entry against <video> elements and hands the URL
   to the download manager. Blob streams are skipped (they cannot be fetched
   that way), matching popup.js behavior. */
const PS_DL_VIDEO_MENU_ID = 'ps_dl_video';

function ensureMenu() {
    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({
            id: PS_DL_VIDEO_MENU_ID,
            title: 'Download this video',
            contexts: ['video']
        });
    });
}

chrome.runtime.onInstalled.addListener(ensureMenu);
chrome.runtime.onStartup.addListener(ensureMenu);

chrome.contextMenus.onClicked.addListener((info) => {
    if (info.menuItemId !== PS_DL_VIDEO_MENU_ID) return;
    const url = info.srcUrl || info.linkUrl || info.pageUrl;
    if (!url || typeof url !== 'string') return;
    if (url.startsWith('blob:')) return;
    chrome.downloads.download({
        url,
        conflictAction: 'uniquify'
    });
});
/* __PS_STORE_STRIP_END__ */

// ---------------------------------------------------------------------------
// Hotkey actions
// ---------------------------------------------------------------------------

// Every action reports back through the tab's TOP frame, so the confirmation
// is visible even when the keystroke came from an embedded player's frame.
function toast(tabId, text) {
    try {
        chrome.tabs.sendMessage(tabId, { type: 'PS_TOAST', text }, { frameId: 0 }, () => {
            void (chrome.runtime && chrome.runtime.lastError); // no receiver = ignore
        });
    } catch (_) { /* tab closed / not scriptable */ }
}

// sender.tab is a snapshot taken when the message was sent, so re-read the tab
// to toggle against its CURRENT mute state.
function toggleMute(tabId) {
    chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError || !tab) return;
        const muted = !(tab.mutedInfo && tab.mutedInfo.muted);
        chrome.tabs.update(tabId, { muted }, () => {
            if (chrome.runtime.lastError) {
                toast(tabId, 'This browser would not mute the tab.');
                return;
            }
            toast(tabId, muted ? 'Tab muted' : 'Tab unmuted');
        });
    });
}

// Toggles every OTHER tab across all windows: mute them while any is still
// unmuted, otherwise unmute them all (so a second press undoes the first).
function toggleMuteOthers(tabId) {
    chrome.tabs.query({}, (tabs) => {
        if (chrome.runtime.lastError) return;
        const others = (tabs || []).filter((t) => t && typeof t.id === 'number' && t.id !== tabId);
        if (!others.length) {
            toast(tabId, 'No other tabs are open.');
            return;
        }
        const mute = others.some((t) => !(t.mutedInfo && t.mutedInfo.muted));
        let pending = others.length;
        let failed = 0;
        others.forEach((t) => {
            chrome.tabs.update(t.id, { muted: mute }, () => {
                if (chrome.runtime.lastError) failed++;
                if (--pending) return;
                const done = others.length - failed;
                toast(tabId, done
                    ? `${mute ? 'Muted' : 'Unmuted'} ${done} other tab${done === 1 ? '' : 's'}`
                    : 'This browser would not mute the other tabs.');
            });
        });
    });
}

// Volume lives in the page (there is no per-tab volume API), so the step is
// broadcast to every frame and whichever frame actually owns media reports the
// resulting level back. Nothing reported within the window = no media anywhere.
const PS_VOL_TIMEOUT = 400;
let volNonce = 0;
const volPending = new Map();

function adjustVolume(tabId, delta) {
    const nonce = ++volNonce;
    volPending.set(nonce, {
        tabId,
        timer: setTimeout(() => {
            if (volPending.delete(nonce)) toast(tabId, 'No audio or video on this page.');
        }, PS_VOL_TIMEOUT)
    });
    try {
        chrome.tabs.sendMessage(tabId, { type: 'PS_VOLUME', delta, nonce }, () => {
            void (chrome.runtime && chrome.runtime.lastError);
        });
    } catch (_) { /* tab closed / not scriptable */ }
}

// First frame to answer for this step wins the toast; later frames are ignored.
function onVolumeResult(msg) {
    const entry = volPending.get(msg.nonce);
    if (!entry) return;
    volPending.delete(msg.nonce);
    clearTimeout(entry.timer);
    toast(entry.tabId, `Volume ${Math.round((msg.level || 0) * 100)}%`);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg) return;
    if (msg.type === 'PS_VOL_RESULT') {
        onVolumeResult(msg);
        return;
    }
    if (msg.type !== 'PS_HOTKEY') return;
    const tabId = sender && sender.tab && sender.tab.id;
    if (typeof tabId !== 'number') return;
    switch (msg.action) {
        case 'selectContainer':
            // The picker overlay only exists in the top frame.
            try {
                chrome.tabs.sendMessage(tabId, { type: 'PS_START_PICK', mode: 'copy' }, { frameId: 0 }, () => {
                    void (chrome.runtime && chrome.runtime.lastError);
                });
            } catch (_) { /* tab closed / not scriptable */ }
            break;
        case 'muteTab': toggleMute(tabId); break;
        case 'muteOthers': toggleMuteOthers(tabId); break;
        case 'volumeUp': adjustVolume(tabId, 0.1); break;
        case 'volumeDown': adjustVolume(tabId, -0.1); break;
        default: return;
    }
    if (sendResponse) sendResponse({ ok: true });
});
