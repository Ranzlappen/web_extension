// Hotkey listener. Registered on <all_urls> in EVERY frame (all_frames), so a
// focused <iframe> player answers the shortcut too and a volume step reaches
// media the top document cannot see. Deliberately separate from content.js:
// sub-frames get only this, never the per-domain CSS injection.
//
// Keystrokes are matched here; the ACTION itself is executed by background.js,
// which owns the chrome.tabs APIs a content script cannot reach. Volume is the
// exception — it is applied here, per frame, to that frame's own media. Nothing
// is registered until a binding is actually enabled.
if (!window.__ps_kx9w4_hk) {
  window.__ps_kx9w4_hk = true;
  (function () {
    const HK = window.PSHotkeys;
    if (!HK) return; // shared contract missing — stay inert rather than throw
    const TOAST_ID = '__ps_kx9w4_toast';
    const REPEATABLE = HK.REPEATABLE || [];
    let combos = null;        // combo string -> action id
    let needsHardMod = true;  // can we bail before building a signature?
    let attached = false;
    let volume = null;        // 0..1 once the user has adjusted this frame
    let watchingMedia = false;
    let toastTimer = null;

    function onKeyDown(e) {
      if (!combos || e.defaultPrevented || e.isComposing) return;
      // Cheap bail-out on the overwhelmingly common keystroke: no Ctrl/Alt/Meta
      // held and no binding that could match without one.
      if (needsHardMod && !e.altKey && !e.ctrlKey && !e.metaKey) return;
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''))) return;
      const combo = HK.signature(e);
      if (!combo) return;
      const action = combos[combo];
      if (!action) return;
      if (e.repeat && REPEATABLE.indexOf(action) === -1) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        chrome.runtime.sendMessage({ type: 'PS_HOTKEY', action }, () => {
          void (chrome.runtime && chrome.runtime.lastError); // no receiver = ignore
        });
      } catch (_) { /* extension context was reloaded — ignore */ }
    }

    function apply(cfg) {
      const map = {};
      let any = false;
      let hard = true;
      if (cfg.enabled) {
        HK.ACTIONS.forEach((a) => {
          const combo = cfg.bindings[a.id];
          if (!combo) return;
          map[combo] = a.id;
          any = true;
          if (!/(^|\+)(Ctrl|Alt|Meta)\+/.test(combo)) hard = false;
        });
      }
      combos = any ? map : null;
      needsHardMod = hard;
      if (any && !attached) {
        document.addEventListener('keydown', onKeyDown, true);
        attached = true;
      } else if (!any && attached) {
        document.removeEventListener('keydown', onKeyDown, true);
        attached = false;
      }
    }

    function mediaElements() {
      try { return Array.prototype.slice.call(document.querySelectorAll('video,audio')); }
      catch (_) { return []; }
    }

    // Sites swap in a fresh <video> for every clip, so re-apply the chosen
    // level as new media starts. Two capture listeners are cheaper than a
    // MutationObserver, and they are only attached after the first adjustment.
    function onNewMedia(e) {
      const el = e.target;
      if (volume === null || !el || (el.tagName !== 'VIDEO' && el.tagName !== 'AUDIO')) return;
      try { el.volume = volume; } catch (_) { /* not settable (e.g. iOS) */ }
    }
    function watchMedia() {
      if (watchingMedia) return;
      watchingMedia = true;
      document.addEventListener('loadstart', onNewMedia, true);
      document.addEventListener('play', onNewMedia, true);
    }

    // Steps this frame's media volume. Returns null when the frame has no
    // media, so background.js can tell "adjusted" from "nothing to adjust".
    function adjustVolume(delta) {
      const els = mediaElements();
      if (!els.length) return null;
      if (volume === null) {
        const current = typeof els[0].volume === 'number' ? els[0].volume : 1;
        volume = Math.max(0, Math.min(1, current));
      }
      volume = Math.max(0, Math.min(1, Math.round((volume + delta) * 100) / 100));
      els.forEach((el) => {
        try {
          el.volume = volume;
          // Raising the volume on element-muted media would otherwise be
          // silent. The browser's tab mute is separate and stays untouched.
          if (volume > 0 && el.muted) el.muted = false;
        } catch (_) { /* ignore elements that refuse the write */ }
      });
      watchMedia();
      return volume;
    }

    // Feedback for actions that change nothing visible (mute, volume). Styles
    // are inline and !important so neither the site's CSS nor the user's own
    // injected snippet can restyle or hide it.
    function showToast(text) {
      if (!text || !document.body) return;
      let el = document.getElementById(TOAST_ID);
      if (!el) {
        el = document.createElement('div');
        el.id = TOAST_ID;
        el.style.cssText = [
          'position:fixed!important', 'left:50%!important', 'bottom:32px!important',
          'transform:translateX(-50%)!important', 'z-index:2147483647!important',
          'background:rgba(15,18,28,.95)!important', 'color:#e6e8ef!important',
          'font:600 14px/1.35 sans-serif!important', 'padding:10px 16px!important',
          'border:1px solid #2a2f44!important', 'border-radius:10px!important',
          'box-shadow:0 4px 16px rgba(0,0,0,.4)!important', 'pointer-events:none!important',
          'max-width:80vw!important', 'text-align:center!important', 'opacity:1!important',
          'display:block!important', 'visibility:visible!important'
        ].join(';') + ';';
        document.body.appendChild(el);
      }
      el.textContent = text;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        const node = document.getElementById(TOAST_ID);
        if (node) node.remove();
      }, 1800);
    }

    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!msg) return;
      if (msg.type === 'PS_VOLUME') {
        const level = adjustVolume(msg.delta);
        // Report back so background.js can toast the level once, in the top
        // frame, instead of every frame announcing its own.
        if (level !== null && msg.nonce) {
          try {
            chrome.runtime.sendMessage({ type: 'PS_VOL_RESULT', nonce: msg.nonce, level }, () => {
              void (chrome.runtime && chrome.runtime.lastError);
            });
          } catch (_) { /* ignore */ }
        }
        if (sendResponse) sendResponse({ ok: true, applied: level !== null });
        return;
      }
      if (msg.type === 'PS_TOAST') {
        showToast(msg.text);
        if (sendResponse) sendResponse({ ok: true });
      }
    });

    try {
      chrome.storage.local.get(HK.STORAGE_KEY, (res) => {
        apply(HK.normalize(res && res[HK.STORAGE_KEY]));
      });
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local' || !changes[HK.STORAGE_KEY]) return;
        apply(HK.normalize(changes[HK.STORAGE_KEY].newValue));
      });
    } catch (_) { /* storage unavailable — hotkeys stay off */ }
  })();
}
