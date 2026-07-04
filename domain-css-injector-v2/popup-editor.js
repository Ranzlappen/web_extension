// CSS-editor niceties for the Style section's textarea: a line-number gutter,
// Tab / Shift+Tab indentation, auto-indent on Enter, Ctrl/Cmd+S to save, and a
// per-domain unsaved-draft restore so closing the popup mid-edit loses nothing.
// Drafts live under the reserved-prefix key `__ps_draft` as
// { "<base-domain>": { base: "<saved CSS the draft was typed on>", text: "<draft>" } }
// — `base` lets a draft be discarded when the saved CSS changed underneath it
// (e.g. Hide Element added a rule while the popup was closed), so a stale
// draft can never silently overwrite newer rules. Loaded after popup.js as a
// classic script so it shares globals (showStatus, activeHost) and listens for
// the `ps:hostchange` event popup.js fires on every domain switch.
(function () {
  const DRAFT_KEY = '__ps_draft';
  let editorHost = null;
  let savedCss = '';
  let draftTimer = null;
  let lastValue = null;

  function $(id) { return document.getElementById(id); }
  const ta = () => $('cssInput');
  const gutter = () => $('cssGutter');

  // --- Line-number gutter --------------------------------------------------
  function refreshGutter() {
    const g = gutter(), t = ta();
    if (!g || !t) return;
    const lines = t.value.split('\n').length || 1;
    if (g.dataset.lines !== String(lines)) {
      g.dataset.lines = String(lines);
      let s = '';
      for (let i = 1; i <= lines; i++) s += i + '\n';
      g.textContent = s;
    }
    g.scrollTop = t.scrollTop;
  }

  // --- Editing helpers -----------------------------------------------------
  // execCommand keeps the native undo stack intact; setRangeText is the
  // fallback where it's unavailable/refused.
  function insertText(text) {
    const t = ta();
    t.focus();
    let ok = false;
    try { ok = document.execCommand && document.execCommand('insertText', false, text); } catch (_) { /* fall through */ }
    if (!ok) {
      t.setRangeText(text, t.selectionStart, t.selectionEnd, 'end');
      t.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function handleTab(shift) {
    const t = ta();
    const s = t.selectionStart, e = t.selectionEnd;
    if (!shift && s === e) { insertText('  '); return; }
    // Line-wise indent / outdent for selections (and Shift+Tab on a caret).
    const v = t.value;
    const lineStart = v.lastIndexOf('\n', s - 1) + 1;
    const block = v.slice(lineStart, e);
    const changed = block
      .split('\n')
      .map((l) => (shift ? l.replace(/^ {1,2}/, '') : '  ' + l))
      .join('\n');
    if (changed === block) return;
    t.setRangeText(changed, lineStart, e, 'select');
    t.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function handleEnter() {
    const t = ta();
    const s = t.selectionStart;
    const line = t.value.slice(t.value.lastIndexOf('\n', s - 1) + 1, s);
    const indent = (line.match(/^[ \t]*/) || [''])[0];
    const extra = /\{\s*$/.test(line) ? '  ' : '';
    insertText('\n' + indent + extra);
  }

  // --- Draft persistence ---------------------------------------------------
  function scheduleDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, 500);
  }

  function saveDraft() {
    if (!editorHost) return;
    const host = editorHost;
    const text = ta().value;
    chrome.storage.local.get(DRAFT_KEY, (r) => {
      const map = r[DRAFT_KEY] || {};
      if (text === savedCss || (!text.trim() && !savedCss)) delete map[host];
      else map[host] = { base: savedCss, text };
      chrome.storage.local.set({ [DRAFT_KEY]: map });
    });
  }

  function dropDraft(host) {
    chrome.storage.local.get(DRAFT_KEY, (r) => {
      const map = r[DRAFT_KEY] || {};
      if (host in map) {
        delete map[host];
        chrome.storage.local.set({ [DRAFT_KEY]: map });
      }
    });
  }

  // Runs after popup.js's own get callback (chrome.storage callbacks are FIFO,
  // and this get is issued after loadHost's), so restoring a draft here safely
  // overrides the saved CSS popup.js just placed in the textarea.
  function loadEditorState(host) {
    editorHost = host;
    clearTimeout(draftTimer);
    chrome.storage.local.get([host, DRAFT_KEY], (r) => {
      savedCss = typeof r[host] === 'string' ? r[host] : '';
      const d = (r[DRAFT_KEY] || {})[host];
      if (d && typeof d.text === 'string' && d.base === savedCss && d.text !== savedCss) {
        ta().value = d.text;
        if (typeof showStatus === 'function') showStatus('Restored an unsaved draft — Save to keep it.', 3000);
      } else if (d && d.base !== savedCss) {
        dropDraft(host); // saved CSS changed underneath the draft — it's stale
      }
      refreshGutter();
    });
  }

  function init() {
    const t = ta();
    if (!t) return;

    t.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        handleTab(e.shiftKey);
      } else if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        handleEnter();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        const saveBtn = $('saveBtn');
        if (saveBtn) saveBtn.click();
      }
    });
    t.addEventListener('input', () => { refreshGutter(); scheduleDraft(); });
    t.addEventListener('scroll', () => { const g = gutter(); if (g) g.scrollTop = t.scrollTop; });

    // Programmatic value changes (host load, presets, import, snippet click)
    // fire no input event — a cheap poll keeps the gutter in step.
    setInterval(() => {
      if (t.value !== lastValue) {
        lastValue = t.value;
        refreshGutter();
      }
    }, 400);

    // A landed save/delete for the current host makes any draft obsolete. If
    // the editor is untouched, follow the new value too — so a Hide Element
    // rule saved from the page shows up in an open sidebar immediately.
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !editorHost || !changes[editorHost]) return;
      const next = typeof changes[editorHost].newValue === 'string' ? changes[editorHost].newValue : '';
      if (t.value === savedCss) {
        t.value = next;
        refreshGutter();
      }
      savedCss = next;
      clearTimeout(draftTimer); // a pending debounce must not resurrect it
      dropDraft(editorHost);
    });

    window.addEventListener('ps:hostchange', (e) => loadEditorState(e.detail));
    if (typeof activeHost !== 'undefined' && activeHost) loadEditorState(activeHost);
    refreshGutter();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
