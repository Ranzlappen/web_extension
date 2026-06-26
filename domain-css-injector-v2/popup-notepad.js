// Per-domain notepad. Notes live under a single reserved-prefix object key
// `__ps_notes` mapping baseDomain -> note string. The `__ps_` prefix can never
// be a real hostname, so it never collides with the bare-domain CSS keys, and
// popup.js excludes it from the snippet list and Export. Loaded after popup.js
// as a classic script so it shares globals (showStatus) and listens for the
// `ps:hostchange` event popup.js fires on every domain switch.
(function () {
  const NOTES_KEY = '__ps_notes';
  let noteHost = null;
  let noteTimer = null;

  function $(id) { return document.getElementById(id); }

  function readNotes(cb) {
    chrome.storage.local.get(NOTES_KEY, (r) => cb(r[NOTES_KEY] || {}));
  }

  function setIndicator(has) {
    const dot = $('notesDot');
    if (dot) dot.hidden = !has;
  }

  function loadNote(host) {
    noteHost = host;
    const domainEl = $('notesDomain');
    if (domainEl) domainEl.textContent = host || 'this site';
    readNotes((map) => {
      const txt = (host && map[host]) || '';
      const input = $('noteInput');
      if (input) input.value = txt;
      setIndicator(!!txt);
    });
  }

  function saveNote() {
    if (!noteHost) return;
    const input = $('noteInput');
    if (!input) return;
    const value = input.value;
    readNotes((map) => {
      if (value) map[noteHost] = value; else delete map[noteHost]; // empty prunes the entry
      chrome.storage.local.set({ [NOTES_KEY]: map }, () => {
        setIndicator(!!value);
      });
    });
  }

  function saveNoteExplicit() {
    saveNote();
    if (typeof showStatus === 'function') showStatus('Note saved.', 1500);
  }

  function clearNote() {
    const input = $('noteInput');
    if (input) input.value = '';
    saveNote();
    if (typeof showStatus === 'function') showStatus('Note cleared.', 1500);
  }

  function init() {
    const input = $('noteInput');
    if (input) {
      // Debounced auto-save so a note is never lost when the popup closes.
      input.addEventListener('input', () => {
        clearTimeout(noteTimer);
        noteTimer = setTimeout(saveNote, 600);
      });
    }
    const saveBtn = $('noteSave');
    if (saveBtn) saveBtn.addEventListener('click', saveNoteExplicit);
    const clearBtn = $('noteClear');
    if (clearBtn) clearBtn.addEventListener('click', clearNote);

    // Reload notes whenever popup.js detects a domain change.
    window.addEventListener('ps:hostchange', (e) => loadNote(e.detail));

    // If popup.js already resolved the host before this script ran, pick it up.
    if (typeof activeHost !== 'undefined' && activeHost) loadNote(activeHost);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
