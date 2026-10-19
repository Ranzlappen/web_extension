// Snippet manager. A full-panel overlay (opened from the Style section) that
// lists every saved per-domain snippet and lets the user edit, add or delete
// them. Works directly on chrome.storage.local[<domain>] — the same public
// key contract as the main editor — and never touches `__ps_` reserved keys.
// Loaded after popup.js as a classic script so it shares isReservedKey() and
// validateCss(); it keeps its own status line because the overlay covers the
// main one.
(function () {
  let editingKey = null; // domain being edited; null while adding a new one
  let armedDelete = null; // domain whose delete button awaits a confirming tap

  function $(id) { return document.getElementById(id); }

  function setMsg(text, timeout = 2500) {
    const el = $('mgrMsg');
    if (!el) return;
    el.textContent = text;
    if (timeout) setTimeout(() => { if (el.textContent === text) el.textContent = ''; }, timeout);
  }

  function show(on) {
    $('mgrOverlay').hidden = !on;
    document.body.style.overflow = on ? 'hidden' : '';
    if (on) { showList(); reload(); }
  }

  function showList() {
    $('mgrForm').hidden = true;
    $('mgrListWrap').hidden = false;
    editingKey = null;
    armedDelete = null;
  }

  function openForm(key, css) {
    editingKey = key;
    $('mgrListWrap').hidden = true;
    $('mgrForm').hidden = false;
    const dom = $('mgrDomain');
    dom.value = key || '';
    dom.readOnly = !!key; // the domain is the storage key — rename = add + delete
    $('mgrCss').value = css || '';
    $('mgrFormTitle').textContent = key ? 'Edit snippet' : 'Add snippet';
    (key ? $('mgrCss') : dom).focus();
  }

  function reload() {
    chrome.storage.local.get(null, render);
  }

  function render(items) {
    const list = $('mgrList');
    list.innerHTML = '';
    const keys = Object.keys(items).filter((k) => !isReservedKey(k)).sort();
    $('mgrCount').textContent = `${keys.length} saved snippet${keys.length === 1 ? '' : 's'}`;
    if (!keys.length) {
      list.textContent = 'No saved snippets yet — tap Add.';
      return;
    }
    keys.forEach((k) => {
      const value = typeof items[k] === 'string' ? items[k] : String(items[k] ?? '');
      const row = document.createElement('div');
      row.className = 'mgr-row';

      const title = document.createElement('strong');
      title.textContent = k;
      const body = document.createElement('div');
      body.className = 'small';
      body.textContent = value.length > 160 ? value.slice(0, 160) + '…' : value;

      const actions = document.createElement('div');
      actions.className = 'controls';
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.textContent = 'Edit';
      edit.addEventListener('click', () => openForm(k, value));
      const del = document.createElement('button');
      del.type = 'button';
      del.textContent = armedDelete === k ? 'Tap again to delete' : 'Delete';
      del.addEventListener('click', () => {
        if (armedDelete !== k) {
          armedDelete = k;
          del.textContent = 'Tap again to delete';
          return;
        }
        armedDelete = null;
        chrome.storage.local.remove([k], () => {
          setMsg(`Deleted ${k}.`);
          reload();
        });
      });
      actions.appendChild(edit);
      actions.appendChild(del);

      row.appendChild(title);
      row.appendChild(body);
      row.appendChild(actions);
      list.appendChild(row);
    });
  }

  function saveForm() {
    const css = $('mgrCss').value;
    let key = editingKey;
    if (!key) {
      key = $('mgrDomain').value.trim().toLowerCase();
      if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(key) || isReservedKey(key)) {
        setMsg('Enter a domain like example.com (no http://, no path).', 3500);
        return;
      }
    }
    if (!css.trim()) { setMsg('CSS is empty — use Delete to remove a snippet.', 3500); return; }
    if (!validateCss(css)) { setMsg('Style is invalid, not saved.', 3500); return; }
    const write = () => chrome.storage.local.set({ [key]: css }, () => {
      showList();
      reload();
      setMsg(`Saved ${key}.`);
    });
    if (editingKey) { write(); return; }
    chrome.storage.local.get(key, (r) => {
      if (typeof r[key] === 'string') setMsg(`${key} already exists — edit it from the list.`, 3500);
      else write();
    });
  }

  function init() {
    if (!$('mgrOverlay')) return;
    $('manageBtn').addEventListener('click', () => show(true));
    $('mgrClose').addEventListener('click', () => show(false));
    $('mgrAdd').addEventListener('click', () => openForm(null, ''));
    $('mgrCancel').addEventListener('click', () => { showList(); reload(); });
    $('mgrSave').addEventListener('click', saveForm);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$('mgrOverlay').hidden) {
        if (!$('mgrForm').hidden) { showList(); reload(); } else show(false);
      }
    });
    // Keep the list fresh if a snippet changes elsewhere while it is open.
    chrome.storage.onChanged.addListener((_c, area) => {
      if (area === 'local' && !$('mgrOverlay').hidden && !$('mgrListWrap').hidden) reload();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
