// Content script. Registered at document_start on <all_urls>. Injects the
// saved per-domain CSS and provides the tap/click element picker. Wrapped in a
// one-time init guard so a re-injection (popup falls back to chrome.scripting
// when the registered instance isn't reachable) can't double-register
// listeners or stack duplicate <style> nodes.
if (!window.__ps_kx9w4_init) {
  window.__ps_kx9w4_init = true;

  function resolveBaseHost(hostname) {
    const parts = hostname.split('.').reverse();
    if (parts.length > 2) return parts[1] + '.' + parts[0];
    return hostname;
  }

  (function () {
    try {
      const host = resolveBaseHost(window.location.hostname);
      chrome.storage.local.get([host], (res) => {
        if (res[host]) {
          const node = document.createElement('style');
          node.id = '__ps_kx9w4_style';
          node.textContent = res[host];
          document.documentElement.appendChild(node);
        }
      });
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local' && changes[host]) {
          // Skip re-injection when the value didn't actually change (e.g. an
          // unrelated key was written in the same set() call).
          if (changes[host].newValue === changes[host].oldValue) return;
          const oldNode = document.getElementById('__ps_kx9w4_style');
          if (oldNode) oldNode.remove();
          const nextNode = document.createElement('style');
          nextNode.id = '__ps_kx9w4_style';
          nextNode.textContent = changes[host].newValue || '';
          document.documentElement.appendChild(nextNode);
        }
      });
    } catch (e) { console.error('style injection error:', e); }
  })();

  if (window.top === window.self) {
    // Record this page's base host while it's the foreground tab. The popup
    // reads `__ps_lasthost` as a fallback when chrome.tabs.query is unreliable
    // (Kiwi / Android forks), so the site is still detected. Guard on
    // visibility so background tab loads can't hijack the recorded host.
    function recordLastHost() {
      if (document.visibilityState !== 'visible') return;
      try {
        const h = resolveBaseHost(window.location.hostname);
        if (h) chrome.storage.local.set({ __ps_lasthost: h });
      } catch (_) { /* ignore (e.g. about:blank, extension errors) */ }
    }
    recordLastHost();
    document.addEventListener('visibilitychange', recordLastHost);
    window.addEventListener('pageshow', recordLastHost);
    window.addEventListener('focus', recordLastHost);

    let pickerActive = false;
    let pickerFrame = null;
    let pickerLabel = null;
    let pickerLinger = null;
    let prevTouchAction = '';

    function selectorFor(el) {
      if (el.id) return '#' + el.id;
      if (el.className && typeof el.className === 'string') {
        const cls = el.className.trim().split(/\s+/).filter(Boolean);
        if (cls.length) return '.' + cls.join('.');
      }
      return el.tagName.toLowerCase();
    }

    function styleLabel(node) {
      node.style.position = 'absolute';
      node.style.background = '#0099ff';
      node.style.color = '#fff';
      node.style.fontSize = '12px';
      node.style.padding = '2px 4px';
      node.style.borderRadius = '3px';
      node.style.zIndex = '1000000';
      node.style.pointerEvents = 'none';
      node.style.maxWidth = '90vw';
      node.style.wordBreak = 'break-all';
    }

    function buildPickerOverlay() {
      pickerFrame = document.createElement('div');
      pickerFrame.style.position = 'absolute';
      pickerFrame.style.background = 'rgba(0, 153, 255, 0.3)';
      pickerFrame.style.border = '2px solid #0099ff';
      pickerFrame.style.zIndex = '999999';
      pickerFrame.style.pointerEvents = 'none';
      document.body.appendChild(pickerFrame);
      pickerLabel = document.createElement('div');
      styleLabel(pickerLabel);
      document.body.appendChild(pickerLabel);
    }

    function ensureLabel() {
      if (!pickerLabel) {
        pickerLabel = document.createElement('div');
        styleLabel(pickerLabel);
        document.body.appendChild(pickerLabel);
      }
    }

    // Coarse pointers (touch) can't hover, so the picker works as: drag a
    // finger to preview the highlight, lift / tap to copy. Fine pointers keep
    // the classic hover-to-preview, click-to-copy behavior.
    const coarsePointer = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

    function enterPickerMode() {
      if (pickerActive) return;
      pickerActive = true;
      buildPickerOverlay();
      // Stop the page from scrolling/zooming while the finger drags to a target.
      prevTouchAction = document.documentElement.style.touchAction;
      document.documentElement.style.touchAction = 'none';
      document.addEventListener('pointermove', onPickerMove, true);
      document.addEventListener('click', onPickerSelect, true);
      document.addEventListener('keydown', onPickerKey, true);
    }

    function exitPickerMode(removeLabel = true) {
      pickerActive = false;
      document.documentElement.style.touchAction = prevTouchAction;
      if (pickerFrame) { pickerFrame.remove(); pickerFrame = null; }
      if (removeLabel && pickerLabel) { pickerLabel.remove(); pickerLabel = null; }
      document.removeEventListener('pointermove', onPickerMove, true);
      document.removeEventListener('click', onPickerSelect, true);
      document.removeEventListener('keydown', onPickerKey, true);
    }

    function elementUnder(x, y) {
      const el = document.elementFromPoint(x, y);
      if (!el || el === pickerFrame || el === pickerLabel) return null;
      return el;
    }

    function positionLabel(clientX, clientY) {
      pickerLabel.style.top = clientY + window.scrollY + 15 + 'px';
      pickerLabel.style.left = clientX + window.scrollX + 15 + 'px';
    }

    function onPickerMove(e) {
      if (!pickerActive || !pickerFrame) return;
      if (e.pointerType === 'touch') e.preventDefault();
      const el = elementUnder(e.clientX, e.clientY);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      pickerFrame.style.top = rect.top + window.scrollY + 'px';
      pickerFrame.style.left = rect.left + window.scrollX + 'px';
      pickerFrame.style.width = rect.width + 'px';
      pickerFrame.style.height = rect.height + 'px';
      if (!pickerLabel.dataset.copied) {
        pickerLabel.textContent = (coarsePointer ? 'tap to copy ' : 'click to copy ') + selectorFor(el);
      }
      positionLabel(e.clientX, e.clientY);
    }

    function onPickerSelect(e) {
      if (!pickerActive) return;
      e.preventDefault();
      e.stopPropagation();
      const el = elementUnder(e.clientX, e.clientY);
      if (!el) { exitPickerMode(); return; }
      const text = selectorFor(el);
      copyText(text).then((ok) => {
        ensureLabel();
        pickerLabel.textContent = ok ? `"${text}" copied to clipboard!` : `selector: ${text} (copy failed — long-press to copy)`;
        pickerLabel.dataset.copied = 'true';
        positionLabel(e.clientX, e.clientY);
        exitPickerMode(false);
        clearTimeout(pickerLinger);
        pickerLinger = setTimeout(() => {
          if (pickerLabel) { pickerLabel.remove(); pickerLabel = null; }
        }, 3500);
      });
    }

    function onPickerKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); exitPickerMode(); }
    }

    function copyText(text) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text).then(() => true).catch(() => fallbackCopy(text));
      }
      return Promise.resolve(fallbackCopy(text));
    }

    function fallbackCopy(text) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.top = '-1000px';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch (_) {
        return false;
      }
    }

    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg && msg.type === 'PS_START_PICK') {
        enterPickerMode();
        if (sendResponse) sendResponse({ ok: true });
      }
    });
  }
}
