#!/usr/bin/env node
/**
 * website-architect.js
 * Maps /content/ files to page sections, writes /src/routing.json,
 * then invokes scripts/build.js.
 *
 * Reads: content/**\/*.md, handoff/content-strategist-report.json (gate check)
 * Writes: src/routing.json, output/index.html (via build.js)
 *
 * Run: node scripts/agents/website-architect.js [--force]
 *   --force  skip content-strategist gate check
 */

'use strict';

const fs             = require('fs');
const path           = require('path');
const crypto         = require('crypto');
const { execFileSync } = require('child_process');

// ─── Paths ────────────────────────────────────────────────────────────────────

const ROOT          = path.resolve(__dirname, '../..');
const CONTENT       = path.join(ROOT, 'content');
const HANDOFF_DIR   = path.join(ROOT, 'handoff');
const SRC_DIR       = path.join(ROOT, 'src');
const ROUTING_FILE  = path.join(SRC_DIR, 'routing.json');
const BUILD_SCRIPT  = path.join(ROOT, 'scripts', 'build.js');

const FORCE = process.argv.includes('--force');

// ─── Gate: require content-strategist pass ────────────────────────────────────

function checkGate() {
  const reportPath = path.join(HANDOFF_DIR, 'content-strategist-report.json');

  if (!fs.existsSync(reportPath)) {
    if (FORCE) {
      console.log('  [gate] No content-strategist report found — skipped (--force)\n');
      return;
    }
    console.error('  [gate] ERROR: content-strategist-report.json not found.');
    console.error('  Run content-strategist first, or pass --force to skip.\n');
    process.exit(1);
  }

  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));

  if (!report.passed && !FORCE) {
    console.error(`  [gate] BLOCKED: content-strategist reported ${report.summary.issues_total} issue(s).`);
    console.error('  Resolve content issues before building, or pass --force to skip.\n');
    process.exit(1);
  }

  if (!report.passed && FORCE) {
    console.log(`  [gate] WARNING: content-strategist has ${report.summary.issues_total} issue(s) — skipped (--force)\n`);
  } else {
    console.log('  [gate] Content strategist: PASSED\n');
  }
}

// ─── Frontmatter parser ───────────────────────────────────────────────────────

function parseFrontmatter(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return {};

  const meta = {};
  match[1].split('\n').forEach(line => {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) return;
    const key   = line.slice(0, colonIdx).trim();
    let value   = line.slice(colonIdx + 1).trim();
    if (value.startsWith('[')) {
      try { value = JSON.parse(value.replace(/'/g, '"')); }
      catch { value = value.replace(/[\[\]]/g, '').split(',').map(s => s.trim().replace(/^["']|["']$/g, '')); }
    } else {
      value = value.replace(/^["']|["']$/g, '');
    }
    meta[key] = value;
  });
  return meta;
}

// ─── File walker ──────────────────────────────────────────────────────────────

function collectDir(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const full = path.join(dir, f);
      const raw  = fs.readFileSync(full, 'utf8');
      return { file: f, full, rel: path.relative(ROOT, full), meta: parseFrontmatter(raw) };
    });
}

// ─── Build hash of all source files ──────────────────────────────────────────

function buildHash() {
  const hash = crypto.createHash('sha256');
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (entry.name.endsWith('.md')) hash.update(fs.readFileSync(full));
    }
  }
  walk(CONTENT);
  return hash.digest('hex').slice(0, 12);
}

// ─── Section mapper ───────────────────────────────────────────────────────────

function mapToSections() {
  const sections = [];

  // Hero — always priority 0
  const profilePath = path.join(CONTENT, 'profile.md');
  if (!fs.existsSync(profilePath)) {
    console.error('  ERROR: content/profile.md is required but missing. Halting.\n');
    fs.writeFileSync(
      path.join(HANDOFF_DIR, 'website-architect-error.md'),
      `---\nagent: website-architect\nerror: missing_required_file\nfile: content/profile.md\n---\n\ncontent/profile.md is required for the hero section but was not found.\n`,
      'utf8'
    );
    process.exit(1);
  }
  const profileMeta = parseFrontmatter(fs.readFileSync(profilePath, 'utf8'));
  sections.push({
    id: 'hero',
    source: 'content/profile.md',
    slug: null,
    priority: 0,
    meta: { name: profileMeta.name, title: profileMeta.title },
  });

  // Availability banner
  const statusPath = path.join(CONTENT, 'status.md');
  if (!fs.existsSync(statusPath)) {
    console.error('  ERROR: content/status.md is required but missing. Halting.\n');
    fs.writeFileSync(
      path.join(HANDOFF_DIR, 'website-architect-error.md'),
      `---\nagent: website-architect\nerror: missing_required_file\nfile: content/status.md\n---\n\ncontent/status.md is required for the availability banner but was not found.\n`,
      'utf8'
    );
    process.exit(1);
  }
  const statusMeta = parseFrontmatter(fs.readFileSync(statusPath, 'utf8'));
  sections.push({
    id: 'status-banner',
    source: 'content/status.md',
    slug: null,
    priority: 0,
    meta: { availability: statusMeta.availability, 'status-label': statusMeta['status-label'] },
  });

  // Work section — case studies sorted by priority
  const caseStudies = collectDir(path.join(CONTENT, 'case-studies'));
  const sortedCS = caseStudies.sort((a, b) => (Number(a.meta.priority) || 99) - (Number(b.meta.priority) || 99));
  for (const cs of sortedCS) {
    sections.push({
      id: 'work',
      source: cs.rel,
      slug: cs.meta.slug || cs.file.replace('.md', ''),
      priority: Number(cs.meta.priority) || 99,
      meta: {
        title: cs.meta.title,
        audience: cs.meta.audience,
        metrics: cs.meta.metrics,
        tags: cs.meta.tags,
        status: cs.meta.status,
      },
    });
  }

  // Thinking section — frameworks sorted by priority or alphabetically
  const frameworks = collectDir(path.join(CONTENT, 'frameworks'));
  const sortedFW = frameworks.sort((a, b) => {
    const pa = Number(a.meta.priority) || 99;
    const pb = Number(b.meta.priority) || 99;
    if (pa !== pb) return pa - pb;
    return a.file.localeCompare(b.file);
  });
  for (const fw of sortedFW) {
    sections.push({
      id: 'thinking',
      source: fw.rel,
      slug: fw.meta.slug || fw.file.replace('.md', ''),
      priority: Number(fw.meta.priority) || 99,
      meta: {
        title: fw.meta.title,
        audience: fw.meta.audience,
        tags: fw.meta.tags,
        status: fw.meta.status,
      },
    });
  }

  // People section — testimonials sorted by priority or filename
  const testimonials = collectDir(path.join(CONTENT, 'testimonials'));
  const sortedT = testimonials.sort((a, b) => {
    const pa = Number(a.meta.priority) || 99;
    const pb = Number(b.meta.priority) || 99;
    if (pa !== pb) return pa - pb;
    return a.file.localeCompare(b.file);
  });
  for (const t of sortedT) {
    sections.push({
      id: 'people',
      source: t.rel,
      slug: t.meta.slug || t.file.replace('.md', ''),
      priority: Number(t.meta.priority) || 99,
      meta: {
        name: t.meta.name,
        title: t.meta.title,
        relationship: t.meta.relationship,
      },
    });
  }

  return sections;
}

// ─── Write routing.json ───────────────────────────────────────────────────────

function writeRouting(sections) {
  const routing = {
    generated: new Date().toISOString(),
    agent: 'website-architect',
    build_hash: buildHash(),
    section_counts: {
      hero: sections.filter(s => s.id === 'hero').length,
      status_banner: sections.filter(s => s.id === 'status-banner').length,
      work: sections.filter(s => s.id === 'work').length,
      thinking: sections.filter(s => s.id === 'thinking').length,
      people: sections.filter(s => s.id === 'people').length,
    },
    sections,
  };

  if (!fs.existsSync(SRC_DIR)) fs.mkdirSync(SRC_DIR, { recursive: true });
  fs.writeFileSync(ROUTING_FILE, JSON.stringify(routing, null, 2), 'utf8');

  return routing;
}

// ─── Write architect handoff report ──────────────────────────────────────────

function writeReport(routing, buildOk) {
  const lines = [
    `---`,
    `agent: website-architect`,
    `run: ${routing.generated}`,
    `passed: ${buildOk}`,
    `build_hash: ${routing.build_hash}`,
    `---`,
    ``,
    `# Website Architect Report`,
    ``,
    `**Run:** ${routing.generated}`,
    `**Status:** ${buildOk ? '✓ PASSED' : '✗ BUILD FAILED'}`,
    `**Build hash:** \`${routing.build_hash}\``,
    ``,
    `## Section Map`,
    ``,
    `| Section | Count | Source(s) |`,
    `|---------|-------|-----------|`,
    `| hero | ${routing.section_counts.hero} | content/profile.md |`,
    `| status-banner | ${routing.section_counts.status_banner} | content/status.md |`,
    `| work | ${routing.section_counts.work} | content/case-studies/ |`,
    `| thinking | ${routing.section_counts.thinking} | content/frameworks/ |`,
    `| people | ${routing.section_counts.people} | content/testimonials/ |`,
    ``,
    `## Routing Config`,
    ``,
    `Written to \`src/routing.json\` (${routing.sections.length} entries).`,
    ``,
  ];

  if (buildOk) {
    lines.push('Build triggered and completed successfully.');
  } else {
    lines.push('Build script exited with an error — see stdout above.');
  }

  if (!fs.existsSync(HANDOFF_DIR)) fs.mkdirSync(HANDOFF_DIR, { recursive: true });
  fs.writeFileSync(path.join(HANDOFF_DIR, 'website-architect-report.md'), lines.join('\n'), 'utf8');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function run() {
  console.log('Website Architect — mapping content to sections\n');

  checkGate();

  const sections = mapToSections();

  console.log(`  Mapped sections:`);
  const counts = {};
  for (const s of sections) counts[s.id] = (counts[s.id] || 0) + 1;
  for (const [id, count] of Object.entries(counts)) {
    console.log(`    ${id.padEnd(16)} ${count} file(s)`);
  }

  const routing = writeRouting(sections);
  console.log(`\n  Routing config written to src/routing.json`);

  // Trigger build.js
  let buildOk = false;
  try {
    console.log('\n  Triggering build.js...\n');
    execFileSync(process.execPath, [BUILD_SCRIPT], { stdio: 'inherit' });
    buildOk = true;
  } catch (err) {
    console.error(`\n  Build failed: ${err.message}`);
  }

  writeReport(routing, buildOk);
  console.log(`\nReport written to handoff/website-architect-report.md`);
  console.log(`Status: ${buildOk ? 'PASSED' : 'FAILED'}\n`);

  process.exit(buildOk ? 0 : 1);
}

run();
