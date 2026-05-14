#!/usr/bin/env node
/**
 * qa-agent.js — Final gate before deploy.
 *
 * Six checks:
 *   1. Link validation (internal anchors, external URLs, assets)
 *   2. Metric consistency (routing.json lead_metrics vs profile.md registry)
 *   3. Persona coverage (case study arrays in routing.json)
 *   4. Status freshness (updated date in status.md)
 *   5. Em-dash guard (zero tolerance in output/index.html)
 *   6. Required sections (hero, work, thinking, people, contact)
 *
 * Writes: reports/qa-report-YYYY-MM-DD-HHMMSS.md
 * Exits 0 on PASS, 1 on CRITICAL failures.
 */

'use strict';

const fs    = require('fs');
const path  = require('path');
const http  = require('http');
const https = require('https');

// ─── Paths ────────────────────────────────────────────────────────────────────

const ROOT        = path.resolve(__dirname, '../..');
const OUTPUT_HTML = path.join(ROOT, 'output', 'index.html');
const ROUTING     = path.join(ROOT, 'src', 'data', 'routing.json');
const PROFILE_MD  = path.join(ROOT, 'content', 'profile.md');
const STATUS_MD   = path.join(ROOT, 'content', 'status.md');
const REPORTS_DIR = path.join(ROOT, 'reports');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tsFile() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function timestamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function parseFrontmatter(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const meta = {};
  match[1].split('\n').forEach(line => {
    const idx = line.indexOf(':');
    if (idx === -1) return;
    meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
  });
  return meta;
}

function extractProfileMetrics(profileRaw) {
  const registry = {};
  const lines = profileRaw.split('\n');
  let inMetrics = false;
  for (const line of lines) {
    if (/^##\s+Metrics\b/.test(line)) { inMetrics = true; continue; }
    if (inMetrics && /^##\s/.test(line)) { inMetrics = false; continue; }
    if (!inMetrics) continue;
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const val = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (key && val) registry[key] = val;
  }
  return registry;
}

function htmlLines(html) {
  return html.split('\n');
}

// ─── CHECK 1: LINK VALIDATION ─────────────────────────────────────────────────

function extractLinks(html) {
  const internal  = [];
  const external  = [];
  const assets    = [];

  // href attributes
  const hrefRe = /href=["']([^"']+)["']/g;
  let m;
  while ((m = hrefRe.exec(html)) !== null) {
    const href = m[1];
    if (href.startsWith('#')) internal.push({ type: 'anchor', value: href });
    else if (href.startsWith('http://') || href.startsWith('https://')) external.push(href);
    else if (!href.startsWith('mailto:') && !href.startsWith('tel:')) internal.push({ type: 'path', value: href });
  }

  // src attributes (images, scripts, etc.)
  const srcRe = /src=["']([^"']+)["']/g;
  while ((m = srcRe.exec(html)) !== null) {
    const src = m[1];
    if (src.startsWith('http://') || src.startsWith('https://')) external.push(src);
    else if (!src.startsWith('data:')) assets.push(src);
  }

  // link href (CSS)
  const linkRe = /<link[^>]+href=["']([^"']+)["'][^>]*>/g;
  while ((m = linkRe.exec(html)) !== null) {
    const href = m[1];
    if (href.startsWith('http://') || href.startsWith('https://')) external.push(href);
    else if (!href.startsWith('data:')) assets.push(href);
  }

  return { internal, external: [...new Set(external)], assets: [...new Set(assets)] };
}

function checkInternalAnchors(html, internalLinks) {
  const criticals = [];
  const anchors = new Set();

  // Collect all id= attributes
  const idRe = /\bid=["']([^"']+)["']/g;
  let m;
  while ((m = idRe.exec(html)) !== null) anchors.add(m[1]);

  for (const link of internalLinks) {
    if (link.type === 'anchor') {
      const id = link.value.slice(1); // strip #
      if (!anchors.has(id)) {
        criticals.push(`Internal anchor not found: ${link.value}`);
      }
    }
    // path-type internal links (e.g. /about) - skip for SPA/single-page builds
  }

  return criticals;
}

function checkAssets(assets) {
  const criticals = [];
  const OUTPUT_DIR = path.join(ROOT, 'output');

  for (const asset of assets) {
    // Resolve relative to output dir
    const assetPath = path.join(OUTPUT_DIR, asset.replace(/^\//, ''));
    if (!fs.existsSync(assetPath)) {
      criticals.push(`Asset file missing: ${asset}`);
    }
  }

  return criticals;
}

function headRequest(rawUrl) {
  return new Promise(resolve => {
    let parsed;
    try { parsed = new URL(rawUrl); } catch { resolve({ ok: false, status: 'invalid-url' }); return; }
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: parsed.hostname,
      path: parsed.pathname + (parsed.search || ''),
      method: 'HEAD',
      timeout: 5000,
      headers: { 'User-Agent': 'PortfolioOS-QA/1.0' },
    }, res => {
      resolve({ ok: res.statusCode >= 200 && res.statusCode < 400, status: res.statusCode });
    });
    req.on('error', () => resolve({ ok: false, status: 0 }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 'timeout' }); });
    req.setTimeout(5000);
    req.end();
  });
}

async function checkExternalLinks(externalLinks) {
  const warnings = [];
  for (const link of externalLinks) {
    const result = await headRequest(link);
    if (!result.ok) {
      warnings.push(`External link non-200 (${result.status}): ${link}`);
    }
  }
  return warnings;
}

// ─── CHECK 2: METRIC CONSISTENCY ──────────────────────────────────────────────

// Metric token suffixes that can be stripped/added during matching (e.g. "810K" matches "810K+")
const METRIC_SUFFIXES = ['%', '+', 'K', 'M', 'B', 'K+', 'M+', 'B+', 'K%', 'M%'];

function tokenMatchesRegistryValue(token, val) {
  if (token === val) return true;
  // Token matches if adding a suffix to token produces the registry value
  if (METRIC_SUFFIXES.some(s => token + s === val)) return true;
  // Token matches if adding a suffix to the registry value produces the token
  if (METRIC_SUFFIXES.some(s => val + s === token)) return true;
  return false;
}

function extractMetricTokens(leadMetric) {
  // Extract metric-like tokens (require at least one digit; no lone commas/periods)
  const re = /\$[\d.]+[KMB%+]*|\d[\d.]*[KMB%+]+|\d+(?=[^.\d,→%KMBx+]|$)/g;
  return (leadMetric.match(re) || []).filter(t => /\d/.test(t));
}

function checkMetricConsistency(routingData, profileRegistry) {
  const criticals = [];
  const registryValues = Object.values(profileRegistry);

  const personas = routingData.personas || {};
  for (const [personaId, persona] of Object.entries(personas)) {
    const leadMetric = persona.lead_metric;
    if (!leadMetric) continue;

    const tokens = extractMetricTokens(leadMetric);
    for (const token of tokens) {
      const found = registryValues.some(val => tokenMatchesRegistryValue(token, val));
      if (!found) {
        criticals.push(
          `Persona "${personaId}" lead_metric references "${token}" not found in profile.md Metrics registry (metric: "${leadMetric}")`
        );
      }
    }
  }

  return criticals;
}

// ─── CHECK 3: PERSONA COVERAGE ────────────────────────────────────────────────

const PRIORITY_PERSONAS  = ['founder-ceo', 'vp-product', 'vp-ai'];
const MIN_PRIORITY_COUNT = 2;

function checkPersonaCoverage(routingData) {
  const criticals = [];
  const personas = routingData.personas || {};

  for (const [personaId, persona] of Object.entries(personas)) {
    const caseStudies = Array.isArray(persona.case_studies) ? persona.case_studies : [];
    if (caseStudies.length === 0) {
      criticals.push(`Persona "${personaId}" has no case studies`);
    } else if (PRIORITY_PERSONAS.includes(personaId) && caseStudies.length < MIN_PRIORITY_COUNT) {
      criticals.push(
        `Priority persona "${personaId}" has only ${caseStudies.length} case study (minimum ${MIN_PRIORITY_COUNT} required)`
      );
    }
  }

  const totalPersonas = Object.keys(personas).length;
  const covered = Object.entries(personas).filter(([, p]) =>
    Array.isArray(p.case_studies) && p.case_studies.length > 0
  ).length;

  return { criticals, totalPersonas, covered };
}

// ─── CHECK 4: STATUS FRESHNESS ────────────────────────────────────────────────

const WARN_DAYS     = 30;
const CRITICAL_DAYS = 90;

function checkStatusFreshness(statusMeta) {
  const updatedStr = statusMeta.updated || statusMeta['updated'];
  if (!updatedStr) {
    return { critical: true, warning: false, message: 'No "updated" field found in status.md', lastUpdated: null };
  }

  const updated = new Date(updatedStr);
  if (isNaN(updated.getTime())) {
    return { critical: true, warning: false, message: `Cannot parse updated date: "${updatedStr}"`, lastUpdated: updatedStr };
  }

  const now = new Date();
  const ageDays = Math.floor((now - updated) / (1000 * 60 * 60 * 24));

  if (ageDays > CRITICAL_DAYS) {
    return {
      critical: true, warning: false,
      message: `Status is ${ageDays} days old (>${CRITICAL_DAYS} day limit): last updated ${updatedStr}`,
      lastUpdated: updatedStr, ageDays,
    };
  }
  if (ageDays > WARN_DAYS) {
    return {
      critical: false, warning: true,
      message: `Status is ${ageDays} days old (>${WARN_DAYS} day advisory): last updated ${updatedStr}`,
      lastUpdated: updatedStr, ageDays,
    };
  }
  return { critical: false, warning: false, message: null, lastUpdated: updatedStr, ageDays };
}

// ─── CHECK 5: EM-DASH GUARD ───────────────────────────────────────────────────

const EM_DASH = '—';

function checkEmDashes(html) {
  const criticals = [];
  // Scan the full HTML file — zero tolerance means script/style blocks count too
  const lines = html.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(EM_DASH)) {
      const context = lines[i].trim().slice(0, 120);
      criticals.push(`Em-dash at line ${i + 1}: ${context}`);
    }
  }
  return criticals;
}

// ─── CHECK 6: REQUIRED SECTIONS ───────────────────────────────────────────────

const REQUIRED_SECTIONS = [
  { name: 'Hero section',         patterns: [/id="hero"/, /class="[^"]*hero/] },
  { name: 'Case studies section', patterns: [/id="work"/, /id="case-studies"/, /class="[^"]*work/, /class="[^"]*case-stud/] },
  { name: 'Frameworks section',   patterns: [/id="thinking"/, /id="frameworks"/, /class="[^"]*thinking/, /class="[^"]*framework/] },
  { name: 'Testimonials section', patterns: [/id="people"/, /id="testimonials"/, /class="[^"]*people/, /class="[^"]*testimonial/] },
  { name: 'Contact section',      patterns: [/id="contact"/, /class="[^"]*contact/] },
];

function checkRequiredSections(html) {
  const criticals = [];
  for (const section of REQUIRED_SECTIONS) {
    const found = section.patterns.some(re => re.test(html));
    if (!found) criticals.push(`Missing required section: ${section.name}`);
  }
  return criticals;
}

// ─── REPORT ───────────────────────────────────────────────────────────────────

function writeReport({ ts, criticals, warnings, linkStats, personaStats, statusInfo, buildMs }) {
  const status   = criticals.length === 0 ? 'PASS' : 'FAIL';
  const blocked  = criticals.length > 0 ? 'yes' : 'no';

  const lines = [
    `# QA Report — ${ts}`,
    `## Status: ${status}`,
    `## Build blocked: ${blocked}`,
    ``,
    `### CRITICAL (blocks deploy)`,
    ``,
    criticals.length === 0
      ? `_None_`
      : criticals.map(c => `- ${c}`).join('\n'),
    ``,
    `### WARNINGS (logged, does not block)`,
    ``,
    warnings.length === 0
      ? `_None_`
      : warnings.map(w => `- ${w}`).join('\n'),
    ``,
    `### Summary`,
    ``,
    `- Links checked: ${linkStats.internal} internal, ${linkStats.external} external, ${linkStats.assets} assets`,
    `- Personas with coverage: ${personaStats.covered}/${personaStats.total}`,
    `- Status freshness: last updated ${statusInfo.lastUpdated || 'unknown'}${statusInfo.ageDays != null ? ` (${statusInfo.ageDays} days ago)` : ''}`,
    `- Build time: ${(buildMs / 1000).toFixed(1)}s`,
    `- Em-dashes found: ${criticals.filter(c => c.startsWith('Em-dash')).length}`,
  ];

  return lines.join('\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const startMs = Date.now();
  const ts = timestamp();
  const tsF = tsFile();

  console.log(`QA Agent — ${ts}\n`);

  // Guard: output HTML must exist
  if (!fs.existsSync(OUTPUT_HTML)) {
    console.error('  ✗ output/index.html not found. Run website-architect first.\n');
    process.exit(1);
  }

  const html    = fs.readFileSync(OUTPUT_HTML, 'utf8');
  const routing = JSON.parse(fs.readFileSync(ROUTING, 'utf8'));
  const profileRaw = fs.readFileSync(PROFILE_MD, 'utf8');
  const profileRegistry = extractProfileMetrics(profileRaw);
  const statusMeta = parseFrontmatter(fs.readFileSync(STATUS_MD, 'utf8'));

  const allCriticals = [];
  const allWarnings  = [];

  // ── CHECK 1: Link validation ────────────────────────────────────────────────
  console.log('── CHECK 1: Link Validation ─────────────────────────────────');
  const { internal, external, assets } = extractLinks(html);

  const anchorCriticals = checkInternalAnchors(html, internal);
  const assetCriticals  = checkAssets(assets);

  if (anchorCriticals.length === 0) {
    console.log(`  ✓ ${internal.length} internal link(s) — all anchors found`);
  } else {
    anchorCriticals.forEach(c => console.error(`  ✗ CRITICAL: ${c}`));
    allCriticals.push(...anchorCriticals);
  }

  if (assetCriticals.length === 0) {
    console.log(`  ✓ ${assets.length} asset(s) — all files present`);
  } else {
    assetCriticals.forEach(c => console.error(`  ✗ CRITICAL: ${c}`));
    allCriticals.push(...assetCriticals);
  }

  console.log(`  ⟳ Checking ${external.length} external link(s)...`);
  const externalWarnings = await checkExternalLinks(external);
  if (externalWarnings.length === 0) {
    console.log(`  ✓ ${external.length} external link(s) — all reachable`);
  } else {
    externalWarnings.forEach(w => console.warn(`  ⚠ WARNING: ${w}`));
    allWarnings.push(...externalWarnings);
  }
  console.log('');

  // ── CHECK 2: Metric consistency ─────────────────────────────────────────────
  console.log('── CHECK 2: Metric Consistency ──────────────────────────────');
  const metricCriticals = checkMetricConsistency(routing, profileRegistry);
  if (metricCriticals.length === 0) {
    console.log(`  ✓ All lead_metric numbers match profile.md registry`);
  } else {
    metricCriticals.forEach(c => console.error(`  ✗ CRITICAL: ${c}`));
    allCriticals.push(...metricCriticals);
  }
  console.log('');

  // ── CHECK 3: Persona coverage ───────────────────────────────────────────────
  console.log('── CHECK 3: Persona Coverage ────────────────────────────────');
  const { criticals: personaCriticals, totalPersonas, covered } = checkPersonaCoverage(routing);
  if (personaCriticals.length === 0) {
    console.log(`  ✓ ${covered}/${totalPersonas} personas have case studies`);
    PRIORITY_PERSONAS.forEach(p => {
      const cs = routing.personas?.[p]?.case_studies || [];
      console.log(`  ✓ ${p}: ${cs.length} case study(s) (priority)`);
    });
  } else {
    personaCriticals.forEach(c => console.error(`  ✗ CRITICAL: ${c}`));
    allCriticals.push(...personaCriticals);
  }
  console.log('');

  // ── CHECK 4: Status freshness ───────────────────────────────────────────────
  console.log('── CHECK 4: Status Freshness ────────────────────────────────');
  const freshness = checkStatusFreshness(statusMeta);
  if (freshness.critical) {
    console.error(`  ✗ CRITICAL: ${freshness.message}`);
    allCriticals.push(freshness.message);
  } else if (freshness.warning) {
    console.warn(`  ⚠ WARNING: ${freshness.message}`);
    allWarnings.push(freshness.message);
  } else {
    console.log(`  ✓ Status updated ${freshness.ageDays} day(s) ago (${freshness.lastUpdated})`);
  }
  console.log('');

  // ── CHECK 5: Em-dash guard ──────────────────────────────────────────────────
  console.log('── CHECK 5: Em-Dash Guard ───────────────────────────────────');
  const emDashCriticals = checkEmDashes(html);
  if (emDashCriticals.length === 0) {
    console.log('  ✓ No em-dashes in rendered HTML — CLEAN');
  } else {
    emDashCriticals.forEach(c => console.error(`  ✗ CRITICAL: ${c}`));
    allCriticals.push(...emDashCriticals);
  }
  console.log('');

  // ── CHECK 6: Required sections ──────────────────────────────────────────────
  console.log('── CHECK 6: Required Sections ───────────────────────────────');
  const sectionCriticals = checkRequiredSections(html);
  const sectionCount = REQUIRED_SECTIONS.length - sectionCriticals.length;
  if (sectionCriticals.length === 0) {
    REQUIRED_SECTIONS.forEach(s => console.log(`  ✓ ${s.name}`));
  } else {
    sectionCriticals.forEach(c => console.error(`  ✗ CRITICAL: ${c}`));
    allCriticals.push(...sectionCriticals);
  }
  console.log(`\n  ${sectionCount}/${REQUIRED_SECTIONS.length} sections present\n`);

  // ── Report ──────────────────────────────────────────────────────────────────
  const buildMs = Date.now() - startMs;
  const reportMd = writeReport({
    ts,
    criticals: allCriticals,
    warnings:  allWarnings,
    linkStats: { internal: internal.length, external: external.length, assets: assets.length },
    personaStats: { covered, total: totalPersonas },
    statusInfo: freshness,
    buildMs,
  });

  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const reportPath = path.join(REPORTS_DIR, `qa-report-${tsF}.md`);
  fs.writeFileSync(reportPath, reportMd, 'utf8');

  const line = '─'.repeat(60);
  console.log(line);
  console.log(`  QA Report: reports/qa-report-${tsF}.md`);
  console.log(`  Status: ${allCriticals.length === 0 ? '✓ PASS' : '✗ FAIL — ' + allCriticals.length + ' critical issue(s)'}`);
  if (allWarnings.length > 0) console.log(`  Warnings: ${allWarnings.length}`);
  console.log(`  Build time: ${(buildMs / 1000).toFixed(1)}s`);
  console.log(line + '\n');

  process.exit(allCriticals.length === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('QA Agent fatal error:', err);
  process.exit(1);
});
