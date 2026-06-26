// High-end password generator. Cryptographically secure (crypto.getRandomValues
// with rejection sampling to remove modulo bias), with character and passphrase
// modes, a live entropy/strength meter, and a clipboard fallback for mobile.
// Loaded after popup.js as a classic script so it shares globals (showStatus).
// Nothing generated is ever persisted — output lives only in the DOM.
(function () {
  // --- Cryptographic randomness ------------------------------------------
  // Uniform integer in [0, max) via rejection sampling. A plain
  // getRandomValues % max skews toward low values when 256 % max !== 0; we
  // discard bytes in the biased tail so every index is equally likely.
  function randIndex(max) {
    if (max <= 0) return 0;
    const limit = 256 - (256 % max); // largest multiple of max <= 256
    const buf = new Uint8Array(1);
    let x;
    do { crypto.getRandomValues(buf); x = buf[0]; } while (x >= limit);
    return x % max;
  }
  function pickFrom(str) { return str[randIndex(str.length)]; }

  // --- Character mode -----------------------------------------------------
  const SETS = {
    lower: 'abcdefghijklmnopqrstuvwxyz',
    upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    digit: '0123456789',
    sym: '!@#$%^&*()-_=+[]{};:,.<>?'
  };
  const AMBIG = /[0O1lI]/g;

  function buildPool(opts) {
    let pool = '';
    const req = [];
    for (const k of ['lower', 'upper', 'digit', 'sym']) {
      if (opts[k]) {
        let s = SETS[k];
        if (opts.noAmbig) s = s.replace(AMBIG, '');
        if (s) { pool += s; req.push(s); }
      }
    }
    return { pool, req };
  }

  function genPassword(opts) {
    const { pool, req } = buildPool(opts);
    if (!pool) return '';
    const out = [];
    // Guarantee one char from each selected set (when requireEach is on).
    if (opts.requireEach) for (const s of req) out.push(pickFrom(s));
    while (out.length < opts.length) out.push(pickFrom(pool));
    // Fisher-Yates shuffle so the guaranteed chars aren't front-loaded.
    for (let i = out.length - 1; i > 0; i--) {
      const j = randIndex(i + 1);
      const t = out[i]; out[i] = out[j]; out[j] = t;
    }
    // slice guards the length < number-of-required-sets edge case.
    return out.slice(0, opts.length).join('');
  }

  // --- Passphrase mode ----------------------------------------------------
  // Exactly 256 curated short words => 8 clean bits/word. No external file/dep.
  const WORDS = [
    'able', 'acid', 'aged', 'also', 'army', 'away', 'baby', 'back', 'ball', 'band', 'bank', 'base', 'bath', 'bean', 'bear', 'beat',
    'bell', 'belt', 'bend', 'bird', 'blue', 'boat', 'body', 'bold', 'bone', 'book', 'boot', 'born', 'boss', 'both', 'bowl', 'bulk',
    'burn', 'bush', 'busy', 'cake', 'call', 'calm', 'camp', 'card', 'care', 'cart', 'case', 'cash', 'cast', 'cave', 'cell', 'chat',
    'chef', 'chip', 'city', 'clay', 'clip', 'club', 'coal', 'coat', 'code', 'cold', 'cook', 'cool', 'cope', 'copy', 'cord', 'core',
    'corn', 'cost', 'crew', 'crop', 'dark', 'data', 'dawn', 'days', 'deal', 'dear', 'deck', 'deep', 'deer', 'desk', 'dial', 'diet',
    'dirt', 'dish', 'dock', 'door', 'dose', 'down', 'drum', 'dual', 'duck', 'dust', 'duty', 'each', 'earn', 'east', 'easy', 'edge',
    'epic', 'even', 'face', 'fact', 'fair', 'fall', 'farm', 'fast', 'fate', 'fear', 'feed', 'feel', 'feet', 'fern', 'file', 'fill',
    'film', 'find', 'fine', 'fire', 'fish', 'five', 'flag', 'flat', 'flow', 'foam', 'fold', 'folk', 'food', 'foot', 'fork', 'form',
    'fort', 'four', 'free', 'frog', 'fuel', 'full', 'fund', 'gain', 'game', 'gate', 'gear', 'gift', 'girl', 'give', 'glad', 'glow',
    'goal', 'goat', 'gold', 'golf', 'good', 'gray', 'grid', 'grow', 'gulf', 'hair', 'half', 'hall', 'hand', 'hang', 'hard', 'harm',
    'hawk', 'head', 'heat', 'help', 'herb', 'hero', 'high', 'hill', 'hint', 'hold', 'hole', 'home', 'hope', 'horn', 'host', 'hour',
    'hunt', 'icon', 'idea', 'iron', 'item', 'jade', 'jazz', 'join', 'joke', 'jump', 'jury', 'keen', 'keep', 'kind', 'king', 'knee',
    'knot', 'know', 'lake', 'lamp', 'land', 'lane', 'last', 'late', 'lawn', 'lead', 'leaf', 'lean', 'lens', 'life', 'lift', 'lime',
    'line', 'link', 'lion', 'list', 'live', 'load', 'loan', 'lock', 'loft', 'long', 'look', 'loop', 'lord', 'loud', 'love', 'luck',
    'lung', 'mail', 'main', 'make', 'mall', 'many', 'mark', 'mask', 'mast', 'mate', 'maze', 'meal', 'mesh', 'mild', 'milk', 'mind',
    'mint', 'mode', 'mood', 'moon', 'moss', 'most', 'moth', 'move', 'much', 'mule', 'nail', 'name', 'navy', 'near', 'neat', 'zero'
  ];

  function genPassphrase(words) {
    const n = Math.max(3, Math.min(12, words));
    const out = [];
    for (let i = 0; i < n; i++) out.push(WORDS[randIndex(WORDS.length)]);
    return out.join('-');
  }

  // --- Strength estimate --------------------------------------------------
  function entropyBits(opts) {
    if (opts.passphrase) return opts.words * Math.log2(WORDS.length);
    const { pool } = buildPool(opts);
    if (!pool) return 0;
    return opts.length * Math.log2(pool.length);
  }
  function bucket(bits) {
    if (bits < 40) return { label: 'weak', color: '#e0563b', pct: 25 };
    if (bits < 70) return { label: 'fair', color: '#e0a23b', pct: 50 };
    if (bits < 100) return { label: 'strong', color: '#4aa3ff', pct: 75 };
    return { label: 'excellent', color: '#3bd07a', pct: 100 };
  }

  // --- Clipboard with mobile fallback ------------------------------------
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
    } catch (_) { return false; }
  }
  function status(msg, t) { if (typeof showStatus === 'function') showStatus(msg, t); }
  function copyPw() {
    const v = document.getElementById('pwOut').textContent;
    if (!v || v === 'Tap Generate') return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(v)
        .then(() => status('Password copied.', 1500))
        .catch(() => status(fallbackCopy(v) ? 'Password copied.' : 'Copy failed.', 1500));
    } else {
      status(fallbackCopy(v) ? 'Password copied.' : 'Copy failed.', 1500);
    }
  }

  // --- UI wiring ----------------------------------------------------------
  function $(id) { return document.getElementById(id); }

  function readOpts() {
    return {
      length: parseInt($('pwLen').value, 10) || 20,
      lower: $('pwLower').checked,
      upper: $('pwUpper').checked,
      digit: $('pwDigit').checked,
      sym: $('pwSym').checked,
      noAmbig: $('pwNoAmbig').checked,
      requireEach: $('pwEach').checked,
      passphrase: $('pwPass').checked,
      words: parseInt($('pwLen').value, 10) || 6
    };
  }

  function renderStrength(opts) {
    const bits = entropyBits(opts);
    const b = bucket(bits);
    const s = $('pwStrength');
    if (s) s.textContent = bits ? `≈ ${Math.round(bits)} bits — ${b.label}` : 'select at least one option';
    const meter = $('pwMeter');
    if (meter) {
      meter.style.width = (bits ? b.pct : 0) + '%';
      meter.style.background = b.color;
    }
  }

  // In passphrase mode the slider counts words (3–12); in char mode it counts
  // characters (4–64). Relabel and re-bound the slider when the mode toggles.
  // Char length and word count are different scales, so each mode keeps its own
  // remembered value — toggling passphrase on/off never silently produces a weak
  // 6-character password from a 6-word setting.
  let lastCharLen = 20;
  let lastWordCount = 6;

  function syncSliderMode() {
    const pass = $('pwPass').checked;
    const slider = $('pwLen');
    if (pass) {
      slider.min = 3; slider.max = 12; slider.value = lastWordCount;
    } else {
      slider.min = 4; slider.max = 64; slider.value = lastCharLen;
    }
    updateLabel();
  }

  function updateLabel() {
    const pass = $('pwPass').checked;
    const label = $('pwLenLabel');
    if (label) label.textContent = (pass ? 'Words: ' : 'Length: ');
    const v = $('pwLenVal');
    if (v) v.textContent = $('pwLen').value;
  }

  function generate() {
    const opts = readOpts();
    let pw;
    if (opts.passphrase) {
      pw = genPassphrase(opts.words);
    } else {
      pw = genPassword(opts);
    }
    const out = $('pwOut');
    if (!pw) {
      if (out) out.textContent = 'Select at least one character set';
      renderStrength(opts);
      return;
    }
    if (out) out.textContent = pw;
    renderStrength(opts);
  }

  function init() {
    if (!$('pwGen')) return; // password panel absent
    $('pwGen').addEventListener('click', generate);
    $('pwCopy').addEventListener('click', copyPw);
    $('pwLen').addEventListener('input', () => {
      const v = parseInt($('pwLen').value, 10);
      if ($('pwPass').checked) lastWordCount = v; else lastCharLen = v;
      updateLabel();
      renderStrength(readOpts());
    });
    ['pwLower', 'pwUpper', 'pwDigit', 'pwSym', 'pwNoAmbig', 'pwEach'].forEach((id) => {
      $(id).addEventListener('change', () => renderStrength(readOpts()));
    });
    $('pwPass').addEventListener('change', () => { syncSliderMode(); renderStrength(readOpts()); });
    updateLabel();
    renderStrength(readOpts());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
