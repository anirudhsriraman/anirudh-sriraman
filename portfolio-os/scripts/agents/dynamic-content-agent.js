#!/usr/bin/env node
/**
 * dynamic-content-agent.js
 * Three responsibilities:
 *   A — Status propagation: status.md → src/data/status.json
 *   B — Routing config: case study scores → src/data/routing.json
 *   C — Metrics registry: reads canonical metrics from profile.md
 *       (cross-check logic lives in case-study-agent; this agent only validates the registry exists)
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT        = path.resolve(__dirname, '../..');
const CONTENT     = path.join(ROOT, 'content');
const CASE_STUDIES = path.join(CONTENT, 'case-studies');
const SRC_DATA    = path.join(ROOT, 'src', 'data');

// ─── Frontmatter parser ───────────────────────────────────────────────────────

function parseFrontmatter(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };

  const meta = {};
  match[1].split('\n').forEach(line => {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) return;
    const key  = line.slice(0, colonIdx).trim();
    let value  = line.slice(colonIdx + 1).trim();
    if (value.startsWith('[')) {
      try {
        value = JSON.parse(value.replace(/'/g, '"'));
      } catch {
        value = value.replace(/[\[\]]/g, '').split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
      }
    } else {
      value = value.replace(/^["']|["']$/g, '');
    }
    meta[key] = value;
  });

  return { meta, body: match[2].trim() };
}

function readMd(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return { ...parseFrontmatter(raw), raw, filePath };
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ─── RESPONSIBILITY A — STATUS PROPAGATION ───────────────────────────────────

function runStatusPropagation() {
  console.log('\n── A. Status Propagation ────────────────────────────────────');

  const statusFile = readMd(path.join(CONTENT, 'status.md'));
  const { meta } = statusFile;

  const availability = meta['availability'] || 'open';
  const targetRoles  = Array.isArray(meta['target-roles']) ? meta['target-roles'] : [meta['target-roles'] || 'Product Leader'];
  const geography    = Array.isArray(meta['geography'])    ? meta['geography']    : [meta['geography']    || 'GCC'];
  const updated      = meta['updated'] || new Date().toISOString().slice(0, 10);

  let statusJson;

  if (availability === 'open') {
    statusJson = {
      availability,
      primary:   `Open to ${targetRoles[0]} roles in ${geography[0]}`,
      secondary: 'Let\'s talk',
      urgency:   true,
      badge:     'Available now',
      updated,
    };
  } else if (availability === 'in-role') {
    statusJson = {
      availability,
      primary:   'Not actively looking — open to exceptional opportunities',
      secondary: 'Connect on LinkedIn',
      urgency:   false,
      badge:     null,
      updated,
    };
  } else if (availability === 'advisory') {
    statusJson = {
      availability,
      primary:   'Available for advisory engagements',
      secondary: 'Discuss scope',
      urgency:   false,
      badge:     'Advisory only',
      updated,
    };
  } else {
    statusJson = {
      availability,
      primary:   meta['status-label'] || 'Available',
      secondary: 'Get in touch',
      urgency:   false,
      badge:     null,
      updated,
    };
  }

  ensureDir(SRC_DATA);
  const outPath = path.join(SRC_DATA, 'status.json');
  fs.writeFileSync(outPath, JSON.stringify(statusJson, null, 2) + '\n', 'utf8');

  console.log(`  availability: ${availability}`);
  console.log(`  primary:      "${statusJson.primary}"`);
  console.log(`  secondary:    "${statusJson.secondary}"`);
  console.log(`  badge:        ${JSON.stringify(statusJson.badge)}`);
  console.log(`  urgency:      ${statusJson.urgency}`);
  console.log(`  → wrote ${path.relative(ROOT, outPath)}`);

  return statusJson;
}

// ─── RESPONSIBILITY B — ROUTING CONFIG ───────────────────────────────────────

const ROUTING_SKELETON = {
  default_persona: 'vp-product',
  personas: {
    'founder-ceo': {
      label: 'Founder / CEO',
      context: 'AI company, ~$20M',
      hero_variant: 'zero-to-one',
      case_studies: [],
      lead_metric: '$6M ARR from zero, Cisco first of 5 enterprise wins',
      lead_framework: 'ai-cx-readiness',
      cta_variant: 'founder',
    },
    'vp-product': {
      label: 'VP of Product',
      context: 'Enterprise B2B SaaS',
      hero_variant: 'commercial',
      case_studies: [],
      lead_metric: '96% retention, 40% expansion revenue, 3 PMs promoted',
      lead_framework: 'roi-model',
      cta_variant: 'operator',
    },
    'vp-ai': {
      label: 'VP / Head of AI Innovation',
      context: 'Any sector',
      hero_variant: 'ai-practitioner',
      case_studies: [],
      lead_metric: '52%→78% NLP accuracy, 5.4M+ labeled data points',
      lead_framework: 'ai-cx-readiness',
      cta_variant: 'technical',
    },
    'vp-dx': {
      label: 'VP of Digital Transformation',
      context: 'Govt, Telco, Retail, Hospitality',
      hero_variant: 'commercial',
      case_studies: [],
      lead_metric: '810K+ calls annually, 30% faster service delivery',
      lead_framework: 'ai-cx-readiness',
      cta_variant: 'operator',
    },
    'vp-cx': {
      label: 'VP of Customer Experience',
      context: 'Govt, Telco, Retail, Hospitality',
      hero_variant: 'cx-practitioner',
      case_studies: [],
      lead_metric: '70%→96% retention, 40% expansion revenue',
      lead_framework: 'roi-model',
      cta_variant: 'operator',
    },
    'recruiter': {
      label: 'Recruiter',
      context: 'Placing senior product leaders',
      hero_variant: 'credentials',
      case_studies: [],
      lead_metric: '14+ years, $6M ARR, 96% retention, 14%→35% win rate',
      lead_framework: null,
      cta_variant: 'recruiter',
    },
  },
};

// Map frontmatter score keys to persona identifiers
const SCORE_FIELDS = {
  'founder-ceo': 'scores_founder_ceo',
  'vp-product':  'scores_vp_product',
  'vp-ai':       'scores_vp_ai',
  'vp-dx':       'scores_vp_dx',
  'vp-cx':       'scores_vp_cx',
  'recruiter':   'scores_recruiter',
};

function runRoutingConfig() {
  console.log('\n── B. Routing Config ────────────────────────────────────────');

  if (!fs.existsSync(CASE_STUDIES)) {
    console.error(`  ✗ Not found: ${CASE_STUDIES}`);
    process.exit(1);
  }

  const files = fs.readdirSync(CASE_STUDIES)
    .filter(f => f.endsWith('.md'))
    .sort()
    .map(f => {
      const file = readMd(path.join(CASE_STUDIES, f));
      return {
        slug:     file.meta.slug || path.basename(f, '.md'),
        priority: Number(file.meta.priority) || 99,
        scores: {
          'founder-ceo': Number(file.meta[SCORE_FIELDS['founder-ceo']]) || 0,
          'vp-product':  Number(file.meta[SCORE_FIELDS['vp-product']])  || 0,
          'vp-ai':       Number(file.meta[SCORE_FIELDS['vp-ai']])       || 0,
          'vp-dx':       Number(file.meta[SCORE_FIELDS['vp-dx']])       || 0,
          'vp-cx':       Number(file.meta[SCORE_FIELDS['vp-cx']])       || 0,
          'recruiter':   Number(file.meta[SCORE_FIELDS['recruiter']])   || 0,
        },
      };
    });

  const routing = JSON.parse(JSON.stringify(ROUTING_SKELETON));

  for (const persona of Object.keys(routing.personas)) {
    const qualifying = files
      .filter(f => f.scores[persona] >= 2)
      .sort((a, b) => {
        // Sort by score descending, then priority ascending
        const scoreDiff = b.scores[persona] - a.scores[persona];
        if (scoreDiff !== 0) return scoreDiff;
        return a.priority - b.priority;
      })
      .slice(0, 3)
      .map(f => f.slug);

    routing.personas[persona].case_studies = qualifying;
  }

  ensureDir(SRC_DATA);
  const outPath = path.join(SRC_DATA, 'routing.json');
  fs.writeFileSync(outPath, JSON.stringify(routing, null, 2) + '\n', 'utf8');

  // Print summary
  console.log('');
  for (const [persona, config] of Object.entries(routing.personas)) {
    const cs = config.case_studies;
    const label = `${persona}`.padEnd(14);
    console.log(`  ${label} → [${cs.join(', ') || 'none'}]`);
  }
  console.log(`\n  → wrote ${path.relative(ROOT, outPath)}`);

  return routing;
}

// ─── RESPONSIBILITY C — METRICS REGISTRY ─────────────────────────────────────

function runMetricsRegistryCheck() {
  console.log('\n── C. Metrics Registry ──────────────────────────────────────');

  const profilePath = path.join(CONTENT, 'profile.md');
  const profile     = readMd(profilePath);

  // Parse the ## Metrics section from profile body line by line
  const lines = profile.body.split('\n');
  let inMetrics = false;
  const metricLines = [];
  for (const line of lines) {
    if (/^##\s+Metrics/.test(line)) { inMetrics = true; continue; }
    if (inMetrics && /^##\s/.test(line)) break;
    if (inMetrics) metricLines.push(line);
  }

  if (metricLines.length === 0) {
    console.warn('  ⚠ No ## Metrics section found in profile.md');
    return {};
  }

  const registry = {};
  metricLines.forEach(line => {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) return;
    const key   = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (key && value) registry[key] = value;
  });

  const count = Object.keys(registry).length;
  console.log(`  Registry: ${count} canonical metrics loaded from profile.md`);

  if (count === 0) {
    console.warn('  ⚠ Metrics section found but no entries parsed');
  } else {
    for (const [k, v] of Object.entries(registry)) {
      console.log(`    ${k.padEnd(30)} ${v}`);
    }
  }

  return registry;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const run = new Date().toISOString();
  console.log(`Dynamic Content Agent — ${run}`);

  const status  = runStatusPropagation();
  const routing = runRoutingConfig();
  runMetricsRegistryCheck();

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  Status: ✓ PASSED`);
  console.log(`${'─'.repeat(60)}\n`);

  process.exit(0);
}

main();
