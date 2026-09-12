// Hotkeys section. Renders the shortcut list from the shared PSHotkeys
// contract (ps-hotkeys.js), lets each binding be re-recorded, and persists the
// result under the reserved `__ps_hotkeys` key — { enabled, bindings }.
// content.js watches that key, so a change applies to already-open pages
// instantly. Loaded after popup.js as a classic script so it shares globals
// (showStatus). Hotkeys are global, not per-domain, so this module ignores
// `ps:hostchange`.
(function () {
  const HK = window.PSHotkeys;
  let cfg = null;
  let recording = null; // action id currently being re-bound

  function $(id) { return document.getElementById(id); }

  // The shared #status line sits at the top of the popup and is scrolled out
  // of view on mobile when this section is open, so outcomes are also shown
  // inline next to the list (same reasoning as the Tabs organizer).
  let noteTimer = null;
  function note(msg, timeout) {
    if (typeof showStatus === 'function') showStatus(msg, timeout);
    const el = $('hkNote');
    if (!el) return;
    el.textContent = msg;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => { el.textContent = ''; }, timeout || 3000);
  }

  function save(next, done) {
    cfg = next;
    chrome.storage.local.set({ [HK.STORAGE_KEY]: next }, () => {
      void (chrome.runtime && chrome.runtime.lastError);
      if (done) done();
    });
  }

  function render() {
    const list = $('hkList');
    if (!list || !cfg) return;
    list.innerHTML = '';
    HK.ACTIONS.forEach((action) => {
      const row = document.createElement('div');
      row.className = 'hk-row';
      const name = document.createElement('span');
      name.className = 'hk-name';
      name.textContent = action.label;
      const key = document.createElement('kbd');
      key.className = 'hk-key';
      if (recording === action.id) {
        row.classList.add('recording');
        key.textContent = 'Press keys…';
      } else {
        key.textContent = HK.format(cfg.bindings[action.id]);
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = recording === action.id ? 'Cancel' : 'Change';
      btn.addEventListener('click', () => {
        if (recording === action.id) stopRecording();
        else startRecording(action.id);
      });
      row.appendChild(name);
      row.appendChild(key);
      row.appendChild(btn);
      list.appendChild(row);
    });
    const toggle = $('hkEnabled');
    if (toggle) toggle.checked = cfg.enabled;
  }

  function startRecording(id) {
    recording = id;
    document.addEventListener('keydown', onRecordKey, true);
    render();
    note('Press the key combination (Esc cancels).', 6000);
  }

  function stopRecording() {
    recording = null;
    document.removeEventListener('keydown', onRecordKey, true);
    render();
  }

  function onRecordKey(e) {
    if (!recording) return;
    // Capture-phase + stopPropagation so the combo can't also trigger the
    // editor's Ctrl/Cmd+S or the browser's own in-popup shortcuts.
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      stopRecording();
      note('Unchanged.', 1500);
      return;
    }
    const combo = HK.signature(e);
    if (!combo) return; // a modifier on its own — keep waiting for the real key
    if (!HK.isAllowed(combo)) {
      note('Add Ctrl, Alt, Shift or Meta (or use F1–F12) — a bare key would clash with the page.', 4000);
      return;
    }
    const clash = HK.ACTIONS.find((a) => a.id !== recording && cfg.bindings[a.id] === combo);
    if (clash) {
      note(`${HK.format(combo)} is already used by "${clash.label}".`, 4000);
      return;
    }
    const id = recording;
    const bindings = Object.assign({}, cfg.bindings, { [id]: combo });
    stopRecording();
    save({ enabled: cfg.enabled, bindings }, () => {
      render();
      note(`Saved — ${HK.format(combo)}.`, 2500);
    });
  }

  function init() {
    if (!HK) return;
    const toggle = $('hkEnabled');
    if (toggle) {
      toggle.addEventListener('change', () => {
        save({ enabled: toggle.checked, bindings: cfg.bindings }, () => {
          note(toggle.checked ? 'Hotkeys enabled.' : 'Hotkeys switched off.', 2000);
        });
      });
    }
    const reset = $('hkReset');
    if (reset) {
      reset.addEventListener('click', () => {
        if (recording) stopRecording();
        save({ enabled: cfg.enabled, bindings: HK.defaults() }, () => {
          render();
          note('Hotkeys reset to defaults.', 2000);
        });
      });
    }
    chrome.storage.local.get(HK.STORAGE_KEY, (res) => {
      cfg = HK.normalize(res && res[HK.STORAGE_KEY]);
      render();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
