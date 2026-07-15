// Content script. Registered at document_start on <all_urls>. Injects the
// saved per-domain CSS and provides the tap/click element picker. Wrapped in a
// one-time init guard so a re-injection (popup falls back to chrome.scripting
// when the registered instance isn't reachable) can't double-register
// listeners or stack duplicate <style> nodes.
if (!window.__ps_kx9w4_init) {
  window.__ps_kx9w4_init = true;

  // Two-label public suffixes under which real sites register a third label
  // (www.bbc.co.uk must resolve to bbc.co.uk, NOT to co.uk — a bare two-label
  // cut would make one site's CSS apply to every .co.uk site). Deliberately a
  // small subset of the Public Suffix List covering the widely used ccTLD
  // second-level zones. KEEP IN SYNC with the copy in popup.js.
  const PS_TWO_LABEL_SUFFIXES = new Set((
    'co.uk org.uk net.uk gov.uk ac.uk sch.uk me.uk ltd.uk plc.uk nhs.uk ' +
    'com.au net.au org.au edu.au gov.au asn.au id.au ' +
    'co.nz net.nz org.nz govt.nz ac.nz school.nz geek.nz ' +
    'co.jp or.jp ne.jp ac.jp go.jp ed.jp gr.jp lg.jp ' +
    'co.kr or.kr ne.kr go.kr re.kr pe.kr ac.kr ' +
    'com.br net.br org.br gov.br edu.br art.br blog.br ' +
    'com.mx org.mx net.mx gob.mx edu.mx ' +
    'com.ar org.ar net.ar gob.ar edu.ar ' +
    'com.co org.co net.co edu.co gov.co ' +
    'com.pe org.pe net.pe gob.pe edu.pe ' +
    'com.ve org.ve net.ve gob.ve ' +
    'com.uy com.ec com.py com.bo com.do com.gt com.sv com.hn com.ni com.pa co.cr ' +
    'co.za org.za net.za gov.za ac.za web.za ' +
    'co.in net.in org.in gov.in ac.in gen.in firm.in ind.in res.in edu.in ' +
    'com.sg org.sg net.sg edu.sg gov.sg ' +
    'com.hk org.hk net.hk edu.hk gov.hk idv.hk ' +
    'com.tw org.tw net.tw edu.tw gov.tw idv.tw ' +
    'com.cn net.cn org.cn gov.cn edu.cn ac.cn ' +
    'com.my net.my org.my gov.my edu.my ' +
    'co.id or.id ac.id go.id web.id sch.id my.id ' +
    'com.ph org.ph net.ph gov.ph edu.ph ' +
    'com.vn net.vn org.vn gov.vn edu.vn ' +
    'co.th or.th ac.th go.th in.th net.th ' +
    'com.tr org.tr net.tr gov.tr edu.tr bel.tr k12.tr ' +
    'co.il org.il net.il gov.il ac.il muni.il ' +
    'com.sa org.sa net.sa gov.sa edu.sa med.sa sch.sa ' +
    'co.ae net.ae org.ae gov.ae ac.ae ' +
    'com.eg org.eg net.eg gov.eg edu.eg ' +
    'com.ng org.ng net.ng gov.ng edu.ng ' +
    'co.ke or.ke ne.ke go.ke ac.ke sc.ke ' +
    'com.pk org.pk net.pk gov.pk edu.pk ' +
    'com.bd org.bd net.bd gov.bd edu.bd ac.bd ' +
    'com.ua org.ua net.ua gov.ua edu.ua in.ua ' +
    'com.pl org.pl net.pl edu.pl gov.pl waw.pl ' +
    'com.es org.es gob.es nom.es edu.es ' +
    'com.gr org.gr net.gr edu.gr gov.gr ' +
    'co.at or.at ac.at gv.at ' +
    'co.rs org.rs edu.rs in.rs'
  ).split(' '));
  function resolveBaseHost(hostname) {
    const parts = hostname.split('.');
    if (parts.length <= 2) return hostname;
    const take = PS_TWO_LABEL_SUFFIXES.has(parts.slice(-2).join('.')) ? 3 : 2;
    return parts.slice(-take).join('.');
  }

  (function () {
    try {
      const host = resolveBaseHost(window.location.hostname);
      const STYLE_ID = '__ps_kx9w4_style';
      const PREVIEW_ID = '__ps_kx9w4_prev';
      // Reserved key: map of base-domain -> true for sites where the user has
      // temporarily switched the saved CSS off without deleting it.
      const OFF_KEY = '__ps_off';
      let savedCss = '';
      let siteOff = false;

      // Single writer for the saved-CSS <style> node: (re)creates it when there
      // is CSS to apply and the site isn't switched off, removes it otherwise —
      // so Delete / toggle-off never leave an empty node behind.
      function syncStyle() {
        const old = document.getElementById(STYLE_ID);
        if (old) old.remove();
        if (!savedCss || siteOff) return;
        const node = document.createElement('style');
        node.id = STYLE_ID;
        node.textContent = savedCss;
        document.documentElement.appendChild(node);
      }
      function clearPreview() {
        const prev = document.getElementById(PREVIEW_ID);
        if (prev) prev.remove();
      }

      chrome.storage.local.get([host, OFF_KEY], (res) => {
        savedCss = res[host] || '';
        siteOff = !!((res[OFF_KEY] || {})[host]);
        syncStyle();
      });
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local') return;
        let dirty = false;
        // Skip re-injection when the value didn't actually change (e.g. an
        // unrelated key was written in the same set() call).
        if (changes[host] && changes[host].newValue !== changes[host].oldValue) {
          savedCss = changes[host].newValue || '';
          clearPreview(); // a save/delete supersedes any live preview
          dirty = true;
        }
        if (changes[OFF_KEY]) {
          const next = !!((changes[OFF_KEY].newValue || {})[host]);
          if (next !== siteOff) { siteOff = next; dirty = true; }
        }
        if (dirty) syncStyle();
      });

      // Live preview: the popup sends the editor's CSS without saving it. The
      // preview node replaces the saved node (so deleted rules disappear too)
      // and lasts until the next save/delete or a page reload.
      if (chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
          if (!msg || msg.type !== 'PS_PREVIEW') return;
          if (typeof msg.css === 'string' && msg.css.trim()) {
            const old = document.getElementById(STYLE_ID);
            if (old) old.remove();
            clearPreview();
            const node = document.createElement('style');
            node.id = PREVIEW_ID;
            node.textContent = msg.css;
            document.documentElement.appendChild(node);
          } else {
            clearPreview();
            syncStyle();
          }
          if (sendResponse) sendResponse({ ok: true });
        });
      }
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
    let pickerMode = 'copy'; // 'copy' → selector to clipboard; 'hide' → save a display:none rule
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

    function cssEscape(s) {
      return (window.CSS && CSS.escape) ? CSS.escape(s) : s.replace(/([^a-zA-Z0-9_-])/g, '\\$1');
    }

    // Hide mode needs a selector that matches ONLY the picked element — a bare
    // tag/class (fine as a copy hint) could blank half the page. Climb from the
    // element, disambiguating repeated siblings with :nth-of-type, and stop as
    // soon as the child chain matches exactly one node (or an id anchors it).
    function preciseSelectorFor(el) {
      const parts = [];
      let node = el;
      while (node && node.nodeType === 1 && node.tagName.toLowerCase() !== 'html') {
        if (node.id) { parts.unshift('#' + cssEscape(node.id)); break; }
        let part = node.tagName.toLowerCase();
        if (typeof node.className === 'string') {
          const cls = node.className.trim().split(/\s+/).filter(Boolean).slice(0, 2);
          if (cls.length) part += '.' + cls.map(cssEscape).join('.');
        }
        const parent = node.parentElement;
        if (parent) {
          const same = Array.prototype.filter.call(parent.children, (s) => s.tagName === node.tagName);
          if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(node) + 1) + ')';
        }
        parts.unshift(part);
        try { if (document.querySelectorAll(parts.join(' > ')).length === 1) break; } catch (_) { /* keep climbing */ }
        node = parent;
      }
      return parts.join(' > ');
    }

    // Append a hide rule to this domain's saved CSS. The storage change makes
    // the injector re-apply the style, so the element disappears immediately
    // (unless the site's CSS is toggled off). Undo = delete the line in the
    // popup editor.
    function appendHideRule(selector, done) {
      try {
        const h = resolveBaseHost(window.location.hostname);
        const rule = selector + ' { display: none !important; }';
        chrome.storage.local.get([h], (res) => {
          const cur = typeof res[h] === 'string' ? res[h] : '';
          const next = cur.trim() ? cur.replace(/\s*$/, '\n') + rule + '\n' : rule + '\n';
          chrome.storage.local.set({ [h]: next }, () => {
            done(!(chrome.runtime && chrome.runtime.lastError));
          });
        });
      } catch (_) { done(false); }
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

    function enterPickerMode(mode) {
      pickerMode = mode === 'hide' ? 'hide' : 'copy';
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
        const verb = pickerMode === 'hide' ? 'hide' : 'copy';
        pickerLabel.textContent = (coarsePointer ? 'tap to ' : 'click to ') + verb + ' ' + selectorFor(el);
      }
      positionLabel(e.clientX, e.clientY);
    }

    function onPickerSelect(e) {
      if (!pickerActive) return;
      e.preventDefault();
      e.stopPropagation();
      const el = elementUnder(e.clientX, e.clientY);
      if (!el) { exitPickerMode(); return; }
      if (pickerMode === 'hide') {
        const sel = preciseSelectorFor(el);
        appendHideRule(sel, (ok) => {
          ensureLabel();
          pickerLabel.textContent = ok
            ? `Hidden — rule saved for this site (delete the "${sel}" line in the editor to undo).`
            : 'Could not save the hide rule.';
          pickerLabel.dataset.copied = 'true';
          positionLabel(e.clientX, e.clientY);
          exitPickerMode(false);
          clearTimeout(pickerLinger);
          pickerLinger = setTimeout(() => {
            if (pickerLabel) { pickerLabel.remove(); pickerLabel = null; }
          }, 4500);
        });
        return;
      }
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
        enterPickerMode(msg.mode);
        if (sendResponse) sendResponse({ ok: true });
      }
    });
  }
}
