// Shared hotkey contract — the single source of truth for the action list, the
// default bindings, and the combo-string format. It is loaded BOTH as the first
// content-script file (so content.js can match keystrokes on every page) and as
// a popup script (so popup-hotkeys.js can render and record them), so it must
// survive being evaluated twice in the same context: everything hangs off one
// namespace object and a re-run is a no-op.
(function (root) {
  if (root.PSHotkeys) return;

  // Reserved key (see the `__ps_` convention): { enabled, bindings }.
  const STORAGE_KEY = '__ps_hotkeys';

  // Action ids are the wire format between content.js and background.js and the
  // key of every saved binding — renaming one silently drops the user's
  // shortcut, so treat them as a contract.
  const ACTIONS = [
    { id: 'selectContainer', label: 'Select container (copy selector)', default: 'Alt+Shift+KeyS' },
    { id: 'muteTab', label: 'Mute / unmute this tab', default: 'Alt+Shift+KeyM' },
    { id: 'muteOthers', label: 'Mute / unmute all other tabs', default: 'Alt+Shift+KeyO' },
    { id: 'volumeUp', label: 'Volume up (page media)', default: 'Alt+Shift+ArrowUp' },
    { id: 'volumeDown', label: 'Volume down (page media)', default: 'Alt+Shift+ArrowDown' }
  ];

  // Actions that should keep firing while the key is held down. Everything else
  // ignores auto-repeat so a held key can't flip a toggle dozens of times.
  const REPEATABLE = ['volumeUp', 'volumeDown'];

  const MODIFIER_CODE = /^(Control|Alt|Shift|Meta)(Left|Right)$/;

  function defaults() {
    const out = {};
    ACTIONS.forEach((a) => { out[a.id] = a.default; });
    return out;
  }

  // Combos are stored modifiers-first in a fixed order, then the layout
  // independent KeyboardEvent.code ("Alt+Shift+KeyS"), so a binding recorded on
  // one keyboard layout still matches on another. Returns null while only a
  // modifier is held (the recorder waits for the real key).
  function signature(e) {
    if (!e || !e.code || MODIFIER_CODE.test(e.code)) return null;
    let s = '';
    if (e.ctrlKey) s += 'Ctrl+';
    if (e.altKey) s += 'Alt+';
    if (e.shiftKey) s += 'Shift+';
    if (e.metaKey) s += 'Meta+';
    return s + e.code;
  }

  const KEY_LABELS = {
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    Equal: '+', Minus: '-', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
    Semicolon: ';', Quote: "'", Backquote: '`', Comma: ',', Period: '.', Slash: '/',
    Space: 'Space', Enter: 'Enter', Escape: 'Esc', Backspace: 'Backspace', Tab: 'Tab'
  };

  // "Alt+Shift+KeyS" -> "Alt+Shift+S" for display only; never parsed back.
  function format(combo) {
    if (!combo) return 'Not set';
    const parts = String(combo).split('+');
    const key = parts.pop();
    let label = KEY_LABELS[key] || key;
    if (/^Key[A-Z]$/.test(key)) label = key.slice(3);
    else if (/^Digit[0-9]$/.test(key)) label = key.slice(5);
    else if (/^Numpad/.test(key)) label = 'Num ' + key.slice(6);
    parts.push(label);
    return parts.join('+');
  }

  // A bare letter would swallow the site's own keyboard shortcuts, so a combo
  // needs at least one modifier. Function keys are the exception — they carry
  // no typing meaning of their own.
  function isAllowed(combo) {
    if (!combo || typeof combo !== 'string') return false;
    if (combo.indexOf('+') > -1) return true;
    return /^F([1-9]|1[0-2])$/.test(combo);
  }

  // Merge saved state over the defaults, so a config written by an older
  // version (missing an action added later) still yields a complete map and a
  // hand-edited/corrupt value can never produce a half-built binding table.
  // An empty-string binding is meaningful: that action is deliberately unbound.
  function normalize(stored) {
    const cfg = stored && typeof stored === 'object' ? stored : {};
    const saved = cfg.bindings && typeof cfg.bindings === 'object' ? cfg.bindings : {};
    const bindings = defaults();
    ACTIONS.forEach((a) => {
      const v = saved[a.id];
      if (typeof v === 'string' && (v === '' || isAllowed(v))) bindings[a.id] = v;
    });
    return { enabled: cfg.enabled !== false, bindings };
  }

  root.PSHotkeys = {
    STORAGE_KEY, ACTIONS, REPEATABLE,
    defaults, signature, format, isAllowed, normalize
  };
})(typeof window !== 'undefined' ? window : self);
