// Background service worker. Registers a "Download this video" item on the
// native browser context menu when a <video> element is right-clicked, and
// hands the URL to chrome.downloads with the same conflictAction as the
// popup-driven flow. Blob streams are skipped (chrome.downloads cannot fetch
// them), matching popup.js behavior.

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
