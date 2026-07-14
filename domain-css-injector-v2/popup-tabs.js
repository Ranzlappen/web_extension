// Tab organizer. Sorts, groups, de-duplicates, and lists the open tabs across
// every window using the already-granted `tabs` permission. Persists nothing —
// every action operates on live tabs — so it needs no chrome.storage key.
// Loaded after popup.js as a classic script so it shares globals (showStatus,
// resolveBaseHost) and listens for the `ps:hostchange` event popup.js fires.
//
// Native tab grouping (chrome.tabs.group / chrome.tabGroups) is Chrome/Edge
// desktop only — absent on Firefox and on the MV2 Kiwi build — so it is
// feature-detected at runtime and the Group button is hidden where unsupported.
(function () {
  let listTimer = null;
  let tabsNoteTimer = null;
  // When the browser can't (or won't) reorder real tabs, fall back to sorting
  // the rendered list by this key so the user still gets a sorted view.
  let viewSortKey = null;

  function $(id) { return document.getElementById(id); }

  function note(msg, timeout) {
    if (typeof showStatus === 'function') showStatus(msg, timeout);
  }

  // Outcome messages must be visible next to the Tabs UI: the shared #status
  // element sits at the top of the popup and is scrolled out of view on
  // mobile when the Tabs section is open — which made failures look silent.
  function tabsNote(msg, timeout) {
    note(msg, timeout);
    const host = $('tabsList');
    if (!host || !host.parentNode) return;
    let el = $('tabsInlineNote');
    if (!el) {
      el = document.createElement('div');
      el.id = 'tabsInlineNote';
      el.className = 'hint';
      host.parentNode.insertBefore(el, host);
    }
    el.textContent = msg;
    clearTimeout(tabsNoteTimer);
    tabsNoteTimer = setTimeout(() => { el.textContent = ''; }, timeout || 4000);
  }

  // Defensive wrapper for callback-style chrome.* calls. Some Chromium forks
  // (Kiwi) throw synchronously, set runtime.lastError, or accept the callback
  // and then NEVER invoke it — an un-guarded await on such a call wedges the
  // popup forever with no error (the "sort silently does nothing" bug).
  // Resolves { ok, result?, err?, timedOut? } and never rejects or hangs.
  function cbCall(invoke, timeoutMs) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (r) => { if (!done) { done = true; resolve(r); } };
      const timer = setTimeout(() => finish({ ok: false, timedOut: true }), timeoutMs || 1500);
      try {
        invoke((result) => {
          clearTimeout(timer);
          const err = chrome.runtime && chrome.runtime.lastError;
          finish(err ? { ok: false, err: err.message || String(err) } : { ok: true, result });
        });
      } catch (e) {
        clearTimeout(timer);
        finish({ ok: false, err: (e && e.message) || String(e) });
      }
    });
  }

  // Enumerate every tab. chrome.windows.getAll({populate:true}) is the canonical
  // "list all tabs" API — it returns each window with its full tabs array,
  // including inactive / discarded ("sleeping") tabs — and is more reliable than
  // a bare chrome.tabs.query({}), which on some Chromium forks (Kiwi/Android)
  // returns only the active tab. We prefer getAll and fall back to query().
  async function queryViaWindows() {
    if (!(chrome.windows && typeof chrome.windows.getAll === 'function')) return null;
    const r = await cbCall((cb) => chrome.windows.getAll({ populate: true }, cb));
    if (!r.ok || !Array.isArray(r.result)) return null;
    const tabs = [];
    for (const w of r.result) if (Array.isArray(w.tabs)) tabs.push(...w.tabs);
    return tabs;
  }
  async function queryViaTabs() {
    const r = await cbCall((cb) => chrome.tabs.query({}, cb));
    return (r.ok && Array.isArray(r.result)) ? r.result : [];
  }
  async function queryAll() {
    const viaWin = await queryViaWindows();
    const tabs = (viaWin && viaWin.length) ? viaWin : await queryViaTabs();
    // De-dupe by tab id (defensive — a tab should only appear once).
    const seen = new Set(), out = [];
    for (const t of tabs) { if (t && !seen.has(t.id)) { seen.add(t.id); out.push(t); } }
    return out;
  }
  function moveTab(id, index) {
    if (!(chrome.tabs && typeof chrome.tabs.move === 'function')) {
      return Promise.resolve({ ok: false, err: 'tabs.move unavailable' });
    }
    return cbCall((cb) => chrome.tabs.move(id, { index }, cb));
  }
  function removeTabs(ids) {
    if (!ids.length) return Promise.resolve({ ok: true });
    return cbCall((cb) => chrome.tabs.remove(ids, cb));
  }

  // Base domain of a tab, reusing popup.js's resolveBaseHost. Tabs without a
  // parseable http(s) URL (chrome://, about:, blank) sort under a stable label.
  function tabDomain(tab) {
    try {
      const u = new URL(tab.url || '');
      if (!u.hostname) return '￿'; // sort browser pages last
      return (typeof resolveBaseHost === 'function') ? resolveBaseHost(u.hostname) : u.hostname;
    } catch (_) { return '￿'; }
  }

  function sortKeyValue(tab, key) {
    if (key === 'title') return (tab.title || '').toLowerCase();
    if (key === 'url') return (tab.url || '').toLowerCase();
    // Default: by domain, then title as a stable tiebreak.
    return tabDomain(tab) + '\u0000' + (tab.title || '').toLowerCase();
  }

  // Group tabs by windowId, preserving discovery order within each window.
  function byWindow(tabs) {
    const map = new Map();
    for (const t of tabs) {
      if (!map.has(t.windowId)) map.set(t.windowId, []);
      map.get(t.windowId).push(t);
    }
    return map;
  }

  // Compare movable tabs (in index order) against the wanted order. Returns
  // how many adjacent pairs are out of order — 0 means correctly sorted.
  function countMisordered(tabs, key) {
    let bad = 0;
    for (const winTabs of byWindow(tabs).values()) {
      const movable = winTabs.filter((t) => !t.pinned).sort((a, b) => a.index - b.index);
      for (let i = 1; i < movable.length; i++) {
        if (sortKeyValue(movable[i - 1], key) > sortKeyValue(movable[i], key)) bad++;
      }
    }
    return bad;
  }

  let sortRunning = false;
  async function sortTabs() {
    if (sortRunning) return; // ignore double-taps while a sort is in flight
    sortRunning = true;
    try {
      const key = ($('tabsSort') && $('tabsSort').value) || 'domain';
      if (!(chrome.tabs && typeof chrome.tabs.move === 'function')) {
        viewSortKey = key;
        tabsNote('This browser cannot reorder tabs — sorted the list below instead.', 4500);
        scheduleRender();
        return;
      }
      const tabs = await queryAll();
      if (!tabs.length) {
        tabsNote('No tabs found — the browser did not answer the tab query.', 3500);
        return;
      }
      let moved = 0, failed = 0, hung = false;
      for (const winTabs of byWindow(tabs).values()) {
        // Pinned tabs hold the leading indices and must not move; only reorder
        // the movable tabs among the index slots they already occupy.
        const movable = winTabs.filter((t) => !t.pinned);
        const slots = movable.map((t) => t.index).sort((a, b) => a - b);
        const ordered = movable.slice().sort((a, b) => {
          const ka = sortKeyValue(a, key), kb = sortKeyValue(b, key);
          return ka < kb ? -1 : ka > kb ? 1 : 0;
        });
        // Track indices locally as moves shift them, so tabs already in place
        // are skipped instead of burning API calls on no-op moves.
        const liveIndex = new Map(movable.map((t) => [t.id, t.index]));
        for (let i = 0; i < ordered.length; i++) {
          const id = ordered[i].id;
          const target = slots[i];
          const current = liveIndex.get(id);
          if (current === target) continue;
          const r = await moveTab(id, target);
          if (r.timedOut) { hung = true; break; } // fork never called back — bail, don't wedge
          if (!r.ok) { failed++; continue; }
          moved++;
          for (const [tid, idx] of liveIndex) {
            if (tid === id) continue;
            if (current > target && idx >= target && idx < current) liveIndex.set(tid, idx + 1);
            else if (current < target && idx > current && idx <= target) liveIndex.set(tid, idx - 1);
          }
          liveIndex.set(id, target);
        }
        if (hung) break;
      }
      // Trust but verify: some forks accept the move and silently ignore it.
      // Re-query and check the real order before claiming success.
      const misordered = countMisordered(await queryAll(), key);
      if (hung || (misordered > 0 && moved === 0)) {
        viewSortKey = key;
        tabsNote('This browser refused to move tabs — sorted the list below instead.', 4500);
      } else if (misordered > 0) {
        viewSortKey = key;
        tabsNote(`Sorted, but the browser refused to move ${failed || misordered} tab${(failed || misordered) === 1 ? '' : 's'} — list below shows the intended order.`, 4500);
      } else {
        viewSortKey = null;
        tabsNote(moved
          ? `Sorted ${moved} tab${moved === 1 ? '' : 's'} by ${key}.`
          : `Tabs were already sorted by ${key}.`);
      }
      scheduleRender();
    } finally {
      sortRunning = false;
    }
  }

  function groupingSupported() {
    return typeof chrome.tabs.group === 'function' && !!chrome.tabGroups;
  }

  async function groupTabs() {
    if (!groupingSupported()) { note('Tab groups are not supported in this browser.', 3000); return; }
    const tabs = await queryAll();
    let groups = 0;
    for (const winTabs of byWindow(tabs).values()) {
      const buckets = new Map();
      for (const t of winTabs) {
        if (t.pinned) continue;
        const d = tabDomain(t);
        if (d === '￿') continue; // skip browser pages
        if (!buckets.has(d)) buckets.set(d, []);
        buckets.get(d).push(t.id);
      }
      for (const [domain, ids] of buckets) {
        if (ids.length < 2) continue; // a lone tab isn't worth a group
        const g = await cbCall((cb) => chrome.tabs.group({ tabIds: ids }, cb));
        if (!g.ok || g.result == null) continue;
        groups++;
        await cbCall((cb) => chrome.tabGroups.update(g.result, { title: domain }, cb));
      }
    }
    tabsNote(`Created ${groups} group${groups === 1 ? '' : 's'} by domain.`);
    scheduleRender();
  }

  async function dedupeTabs() {
    const tabs = await queryAll();
    const seen = new Set();
    const dupes = [];
    for (const t of tabs) {
      if (t.pinned || !t.url) continue;
      if (seen.has(t.url)) dupes.push(t.id); else seen.add(t.url);
    }
    const r = await removeTabs(dupes);
    if (dupes.length && !r.ok) {
      tabsNote('The browser refused to close the duplicate tabs.', 3500);
    } else {
      tabsNote(`Closed ${dupes.length} duplicate tab${dupes.length === 1 ? '' : 's'}.`);
    }
    scheduleRender();
  }

  function focusTab(tab) {
    try { chrome.tabs.update(tab.id, { active: true }, () => { void chrome.runtime.lastError; }); } catch (_) {}
    // Bring the owning window forward where the API exists (desktop).
    if (chrome.windows && typeof chrome.windows.update === 'function') {
      try { chrome.windows.update(tab.windowId, { focused: true }, () => { void chrome.runtime.lastError; }); } catch (_) {}
    }
  }

  function renderList() {
    const host = $('tabsList');
    if (!host) return;
    const filter = (($('tabsFilter') && $('tabsFilter').value) || '').toLowerCase();
    queryAll().then((tabs) => {
      host.textContent = '';
      const matches = tabs.filter((t) => {
        if (!filter) return true;
        return (t.title || '').toLowerCase().includes(filter) || (t.url || '').toLowerCase().includes(filter);
      });
      // Fallback view-sort: when the browser can't reorder real tabs, at least
      // present the list in the order the user asked for.
      if (viewSortKey) {
        matches.sort((a, b) => {
          const ka = sortKeyValue(a, viewSortKey), kb = sortKeyValue(b, viewSortKey);
          return ka < kb ? -1 : ka > kb ? 1 : 0;
        });
      }
      // Always show a count so it's obvious every tab was found.
      const count = document.createElement('div');
      count.className = 'small';
      count.textContent = filter
        ? `${matches.length} of ${tabs.length} tab${tabs.length === 1 ? '' : 's'}`
        : `${tabs.length} tab${tabs.length === 1 ? '' : 's'}`;
      host.appendChild(count);
      if (!matches.length) {
        const empty = document.createElement('div');
        empty.className = 'small';
        empty.textContent = filter ? 'No tabs match.' : 'No tabs.';
        host.appendChild(empty);
        return;
      }
      for (const t of matches) {
        const row = document.createElement('div');
        row.className = 'tab-row';

        const open = document.createElement('button');
        open.className = 'tab-open';
        open.type = 'button';
        open.title = t.url || '';
        open.textContent = t.title || t.url || '(untitled)';
        open.addEventListener('click', () => focusTab(t));

        const close = document.createElement('button');
        close.className = 'tab-close';
        close.type = 'button';
        close.title = 'Close tab';
        close.textContent = '✕';
        close.addEventListener('click', () => { removeTabs([t.id]).then(scheduleRender); });

        row.appendChild(open);
        row.appendChild(close);
        host.appendChild(row);
      }
    });
  }

  // Coalesce rapid re-render requests (after each mutation) into one pass.
  function scheduleRender() {
    clearTimeout(listTimer);
    listTimer = setTimeout(renderList, 120);
  }

  function init() {
    const doSort = $('tabsSortBtn');
    if (doSort) doSort.addEventListener('click', sortTabs);
    const groupBtn = $('tabsGroupBtn');
    if (groupBtn) {
      if (groupingSupported()) groupBtn.addEventListener('click', groupTabs);
      else groupBtn.hidden = true; // hide where native groups don't exist
    }
    const dedupeBtn = $('tabsDedupeBtn');
    if (dedupeBtn) dedupeBtn.addEventListener('click', dedupeTabs);
    const filter = $('tabsFilter');
    if (filter) filter.addEventListener('input', scheduleRender);

    // Re-render when the user expands the section so the list is fresh.
    const sec = $('tabsSection');
    if (sec) sec.addEventListener('toggle', () => { if (sec.open) renderList(); });

    // Keep the list current across domain switches like the other modules.
    window.addEventListener('ps:hostchange', scheduleRender);

    renderList();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
