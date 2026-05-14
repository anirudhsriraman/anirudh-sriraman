#!/usr/bin/env node
/**
 * content-strategist.js
 * Audits /content/ Markdown files against four content rules.
 * Writes /handoff/content-strategist-report.md on completion.
 *
 * Rules:
 *   1. Every achievement claim must include a metric
 *   2. No em-dashes (U+2014) in body copy
 *   3. Case studies must have context, action, and outcome sections + metrics array
 *   4. Profile metrics must be evidenced somewhere in content
 *
 * Run: node scripts/agents/content-strategist.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ─── Paths ────────────────────────────────────────────────────────────────────

const ROOT        = path.resolve(__dirname, '../..');
const CONTENT     = path.join(ROOT, 'content');
const HANDOFF_DIR = path.join(ROOT, 'handoff');

// ─── Frontmatter parser ───────────────────────────────────────────────────────

function parseFrontmatter(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };

  const meta = {};
  const fmLines = match[1].split('\n');
  let i = 0;

  while (i < fmLines.length) {
    const line = fmLines[i];
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) { i++; continue; }

    const key   = line.slice(0, colonIdx).trim();
    let value   = line.slice(colonIdx + 1).trim();

    // Detect multi-line YAML array: `key:` with no value, followed by `  - item` lines
    if (value === '' && i + 1 < fmLines.length && /^\s+-\s/.test(fmLines[i + 1])) {
      const items = [];
      i++;
      while (i < fmLines.length && /^\s+-\s/.test(fmLines[i])) {
        items.push(fmLines[i].replace(/^\s+-\s+/, '').replace(/^["']|["']$/g, ''));
        i++;
      }
      meta[key] = items;
      continue;
    }

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
    i++;
  }

  return { meta, body: match[2].trim() };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readMd(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return { ...parseFrontmatter(raw), raw, filePath };
}

function relPath(filePath) {
  return path.relative(ROOT, filePath);
}

function bodyLines(body) {
  return body.split('\n');
}

// ─── Rule 1: Claims must have metrics ─────────────────────────────────────────

const ACHIEVEMENT_VERBS = /\b(improved|improvement|increased|increase|reduced|reduction|grew|growth|built|launched|delivered|led|drove|generated|achieved|accelerated|climbed|processed|scaled|recovered|retained|rebuilt|repositioned|converted|managed|created|cut)\b/i;
const METRIC_PATTERN    = /(\d[\d,]*%|\$[\d,.]+[KMB]?|\d[\d,.]*[KMBx+]|\d+\s*(months?|weeks?|days?|years?|engineers?|PMs?|products?|calls?|dimensions?|tiers?|layers?|persons?)|\d+[-–]\w+|\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|forty|fifty|hundred)\b[\s-]+(dimension|category|week|month|day|year|engineer|pm|product|call|tier|layer|point)s?)/i;

function stripNonContentSections(body) {
  // Strip ## Metrics and ## Audiences sections — they contain registry data,
  // not achievement claims, so the claims check should not run on them.
  const lines = body.split('\n');
  const result = [];
  let inSection = false;
  for (const line of lines) {
    if (/^##\s+(Metrics|Audiences)\b/.test(line)) { inSection = true; continue; }
    if (inSection && /^##\s/.test(line)) inSection = false;
    if (!inSection) result.push(line);
  }
  return result.join('\n');
}

function checkClaims(file) {
  const issues = [];
  const checkBody = stripNonContentSections(file.body);
  const lines  = bodyLines(checkBody);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip headings, frontmatter markers, blank lines, bullet-point metrics
    if (/^#+\s|^-{3}$|^\s*$|^\*\*Metrics:\*\*/.test(line)) continue;
    // Skip table rows — they are descriptive, not achievement claims
    if (/^\s*\|/.test(line)) continue;
    // Skip YAML-like key-value lines in body (e.g., metrics registry entries)
    if (/^\s*[\w-]+:\s+["']?\d/.test(line) || /^\s*[\w-]+:\s+"/.test(line)) continue;

    if (ACHIEVEMENT_VERBS.test(line)) {
      // Check current line + next line for a metric
      const window = line + ' ' + (lines[i + 1] || '');
      if (!METRIC_PATTERN.test(window)) {
        issues.push({
          rule: 'unsupported_claims',
          file: relPath(file.filePath),
          line: i + 1,
          detail: `Achievement claim without metric: "${line.trim().slice(0, 100)}"`,
        });
      }
    }
  }

  return issues;
}

// ─── Rule 2: No em-dashes ─────────────────────────────────────────────────────

function checkEmDashes(file) {
  const issues = [];
  const lines  = bodyLines(file.body);

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('—')) {
      issues.push({
        rule: 'em_dashes',
        file: relPath(file.filePath),
        line: i + 1,
        detail: `Em-dash found: "${lines[i].trim().slice(0, 100)}"`,
      });
    }
  }

  return issues;
}

// ─── Rule 3: Case study section structure ─────────────────────────────────────

const SECTION_PATTERNS = {
  context:  /^##\s+(Context|Situation|Challenge|Problem|Background)\b/i,
  action:   /^##\s+(Action|Solution|Approach|Decision|Response|Fix)\b/i,
  outcome:  /^##\s+(Outcome|Result|Impact|Delivery)\b/i,
};

function checkCaseStudyStructure(file) {
  const issues  = [];
  const found   = { context: false, action: false, outcome: false };
  const lines   = bodyLines(file.body);

  for (const line of lines) {
    if (SECTION_PATTERNS.context.test(line))  found.context = true;
    if (SECTION_PATTERNS.action.test(line))   found.action  = true;
    if (SECTION_PATTERNS.outcome.test(line))  found.outcome = true;
  }

  for (const [section, present] of Object.entries(found)) {
    if (!present) {
      issues.push({
        rule: 'missing_sections',
        file: relPath(file.filePath),
        line: null,
        detail: `Missing required section: "${section}" (expected heading like ## Context, ## Situation, ## Action, ## Outcome, etc.)`,
      });
    }
  }

  const metrics = file.meta.metrics;
  if (!metrics || (Array.isArray(metrics) && metrics.length === 0) || metrics === '') {
    issues.push({
      rule: 'missing_sections',
      file: relPath(file.filePath),
      line: null,
      detail: 'Missing frontmatter "metrics" array or array is empty',
    });
  }

  return issues;
}

// ─── Rule 4: Profile metric consistency ───────────────────────────────────────

function extractMetrics(body) {
  const matches = body.match(/\$[\d,.]+[KMB]?|\d[\d,]*%|\d[\d,.]*[KMB]\b/g) || [];
  return [...new Set(matches)];
}

function profileBodyWithoutRegistry(body) {
  // Strip ## Metrics (the canonical registry) and ## Audiences (audience metadata)
  // so their values are not treated as claims that need case-study evidence.
  const lines = body.split('\n');
  const result = [];
  let inSection = false;
  for (const line of lines) {
    if (/^##\s+(Metrics|Audiences)\b/.test(line)) { inSection = true; continue; }
    if (inSection && /^##\s/.test(line)) inSection = false;
    if (!inSection) result.push(line);
  }
  return result.join('\n');
}

function checkProfileMetrics(profile, allFiles) {
  const issues         = [];
  const profileBody    = profileBodyWithoutRegistry(profile.body);
  const profileMetrics = extractMetrics(profileBody);
  const allBody        = allFiles
    .filter(f => f.filePath !== profile.filePath)
    .map(f => f.body)
    .join('\n');

  for (const metric of profileMetrics) {
    const cleaned = metric.replace(/[.,]$/, '');
    if (!allBody.includes(cleaned)) {
      issues.push({
        rule: 'unanchored_metrics',
        file: relPath(profile.filePath),
        line: null,
        detail: `Profile metric "${cleaned}" has no matching evidence in case studies or frameworks`,
      });
    }
  }

  return issues;
}

// ─── Collect all content files ────────────────────────────────────────────────

function collectFiles() {
  const files = [];

  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.md')) {
        files.push(readMd(full));
      }
    }
  }

  walk(CONTENT);
  return files;
}

// ─── Main audit ───────────────────────────────────────────────────────────────

function audit() {
  console.log('Content Strategist — running audit\n');

  const allFiles  = collectFiles();
  const profile   = allFiles.find(f => f.filePath.endsWith('profile.md'));
  const caseStudyFiles = allFiles.filter(f => f.filePath.includes('case-studies'));

  console.log(`  Files found: ${allFiles.length}`);
  console.log(`  Case studies: ${caseStudyFiles.length}\n`);

  const allIssues = [];

  for (const file of allFiles) {
    const isCS = file.filePath.includes('case-studies');
    const fileIssues = [];

    fileIssues.push(...checkEmDashes(file));

    // Claim checks on body-heavy files only (skip testimonials — they're quotes)
    if (!file.filePath.includes('testimonials')) {
      fileIssues.push(...checkClaims(file));
    }

    if (isCS) {
      fileIssues.push(...checkCaseStudyStructure(file));
    }

    if (fileIssues.length) {
      console.log(`  [issues] ${relPath(file.filePath)}: ${fileIssues.length} issue(s)`);
    } else {
      console.log(`  [ok]     ${relPath(file.filePath)}`);
    }

    allIssues.push(...fileIssues);
  }

  // Profile metric check (cross-file)
  if (profile) {
    const profileIssues = checkProfileMetrics(profile, allFiles);
    allIssues.push(...profileIssues);
    if (profileIssues.length) {
      console.log(`\n  [issues] profile metric cross-check: ${profileIssues.length} unanchored metric(s)`);
    } else {
      console.log('\n  [ok]     profile metric cross-check');
    }
  }

  // ─── Build report ──────────────────────────────────────────────────────────

  const passed = allIssues.length === 0;
  const greenFiles = allFiles
    .filter(f => !allIssues.some(i => i.file === relPath(f.filePath)))
    .map(f => relPath(f.filePath));

  const byRule = {
    unsupported_claims:  allIssues.filter(i => i.rule === 'unsupported_claims').length,
    em_dashes:           allIssues.filter(i => i.rule === 'em_dashes').length,
    missing_sections:    allIssues.filter(i => i.rule === 'missing_sections').length,
    unanchored_metrics:  allIssues.filter(i => i.rule === 'unanchored_metrics').length,
  };

  const report = {
    run: new Date().toISOString(),
    agent: 'content-strategist',
    passed,
    summary: {
      files_checked: allFiles.length,
      issues_total: allIssues.length,
      issues_by_rule: byRule,
    },
    issues: allIssues,
    green_files: greenFiles,
  };

  // Markdown report
  const lines = [
    `---`,
    `agent: content-strategist`,
    `run: ${report.run}`,
    `passed: ${passed}`,
    `issues_total: ${allIssues.length}`,
    `---`,
    ``,
    `# Content Strategist Report`,
    ``,
    `**Run:** ${report.run}`,
    `**Status:** ${passed ? '✓ PASSED' : '✗ FAILED'}`,
    `**Files checked:** ${allFiles.length}`,
    `**Issues:** ${allIssues.length}`,
    ``,
    `## Summary`,
    ``,
    `| Rule | Issues |`,
    `|------|--------|`,
    `| Unsupported claims | ${byRule.unsupported_claims} |`,
    `| Em-dashes | ${byRule.em_dashes} |`,
    `| Missing sections | ${byRule.missing_sections} |`,
    `| Unanchored profile metrics | ${byRule.unanchored_metrics} |`,
    ``,
  ];

  if (allIssues.length) {
    lines.push('## Issues', '');
    for (const issue of allIssues) {
      const loc = issue.line ? `:${issue.line}` : '';
      lines.push(`### ${issue.file}${loc}`);
      lines.push(`**Rule:** \`${issue.rule}\``);
      lines.push(`**Detail:** ${issue.detail}`);
      lines.push('');
    }
  }

  if (greenFiles.length) {
    lines.push('## Clean Files', '');
    for (const f of greenFiles) lines.push(`- ${f}`);
    lines.push('');
  }

  const mdReport  = lines.join('\n');
  const jsonReport = JSON.stringify(report, null, 2);

  if (!fs.existsSync(HANDOFF_DIR)) fs.mkdirSync(HANDOFF_DIR, { recursive: true });
  fs.writeFileSync(path.join(HANDOFF_DIR, 'content-strategist-report.md'), mdReport, 'utf8');
  fs.writeFileSync(path.join(HANDOFF_DIR, 'content-strategist-report.json'), jsonReport, 'utf8');

  console.log(`\nReport written to handoff/content-strategist-report.md`);
  console.log(`Status: ${passed ? 'PASSED' : 'FAILED'} (${allIssues.length} issues)\n`);

  return report;
}

const result = audit();
process.exit(result.passed ? 0 : 1);
