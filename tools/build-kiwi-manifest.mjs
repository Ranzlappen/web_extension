#!/usr/bin/env node
// Derive the Manifest V2 (Kiwi / Android Chromium) manifest from the canonical
// Manifest V3 manifest. manifest.json (MV3) is the single source of truth for
// name / version / description / icons / content scripts; this script applies
// the MV2-specific transform so the two can never drift in version.
//
// Kiwi Browser only has experimental MV3 support and silently fails to load an
// MV3 manifest, so the mobile build ships as MV2. The popup JS feature-detects
// chrome.scripting vs chrome.tabs.executeScript, so the SAME scripts run under
// both manifests — only the manifest differs.
//
// Usage:
//   node tools/build-kiwi-manifest.mjs [path/to/manifest.json] > manifest.kiwi.json
// Defaults to domain-css-injector-v2/manifest.json. Prints the MV2 JSON to stdout.

import { readFileSync } from 'node:fs';

const src = process.argv[2] || 'domain-css-injector-v2/manifest.json';
const m = JSON.parse(readFileSync(src, 'utf8'));

// host_permissions (MV3) fold into permissions (MV2); 'scripting' is MV3-only.
const permissions = [
  ...(m.permissions || []).filter((p) => p !== 'scripting'),
  ...(m.host_permissions || [])
];

// MV3 background.service_worker (or its Firefox-fallback scripts) -> MV2 event page.
const bgScripts = m.background?.scripts?.length
  ? m.background.scripts
  : [m.background?.service_worker].filter(Boolean);

const v2 = {
  manifest_version: 2,
  name: m.name,
  version: m.version,
  description: m.description,
  permissions,
  icons: m.icons,
  // MV3 action -> MV2 browser_action.
  browser_action: {
    default_popup: m.action?.default_popup,
    default_title: m.action?.default_title || m.name,
    default_icon: m.action?.default_icon || m.icons
  },
  background: { scripts: bgScripts, persistent: false },
  content_scripts: m.content_scripts
};
// Dropped vs MV3: sidebar_action (no sidebar on Kiwi), browser_specific_settings
// (Firefox-only — some Kiwi builds choke on the unknown key), host_permissions
// (folded above), and the MV3 'action'/'service_worker' shapes.

process.stdout.write(JSON.stringify(v2, null, 2) + '\n');
