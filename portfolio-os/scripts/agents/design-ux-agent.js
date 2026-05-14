#!/usr/bin/env node
/**
 * design-ux-agent.js
 * Four capabilities: token-enforcement, em-dash-guard, mobile-check, component-audit.
 *
 * Usage:
 *   node scripts/agents/design-ux-agent.js
 *   node scripts/agents/design-ux-agent.js --dry-run
 *
 * Reads:  src/styles/ (CSS design tokens), output/index.html (built page)
 * Writes: handoff/design-ux-report.md
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ─── Paths ────────────────────────────────────────────────────────────────────

const ROOT        = path.resolve(__dirname, '../..');
const STYLES_DIR  = path.join(ROOT, 'src', 'styles');
const OUTPUT_HTML = path.join(ROOT, 'output', 'index.html');
const HANDOFF_DIR = path.join(ROOT, 'handoff');
const REPORT_PATH = path.join(HANDOFF_DIR, 'design-ux-report.md');

const DRY_RUN = process.argv.includes('--dry-run');

// ─── Required design tokens ───────────────────────────────────────────────────

const REQUIRED_TOKENS = [
  { name: '--bg',          purpose: 'page background' },
  { name: '--bg-surface',  purpose: 'card/section background' },
  { name: '--text',        purpose: 'body text' },
  { name: '--text-muted',  purpose: 'secondary text' },
  { name: '--accent',      purpose: 'highlights, links, teal' },
  { name: '--accent-light',purpose: 'accent tint for badges' },
  { name: '--border',      purpose: 'all borders' },
  { name: '--bg-inverse',  purpose: 'inverse/dark background' },
  { name: '--text-inverse',purpose: 'text on inverse background' },
];

// ─── Component signatures ─────────────────────────────────────────────────────

const REQUIRED_COMPONENTS = [
  {
    name: 'Hero section',
    patterns: [/id="hero"/, /class="[^"]*hero[^"]*"/],
  },
  {
    name: 'Case studies section',
    patterns: [/id="work"/, /class="[^"]*work[^"]*"/, /id="case-studies"/, /class="[^"]*case-stud/],
  },
  {
    name: 'Frameworks section',
    patterns: [/id="thinking"/, /class="[^"]*thinking[^"]*"/, /id="frameworks"/, /class="[^"]*framework/],
  },
  {
    name: 'Testimonials section',
    patterns: [/id="people"/, /class="[^"]*people[^"]*"/, /id="testimonials"/, /class="[^"]*testimonial/],
  },
  {
    name: 'Contact section',
    patterns: [/id="contact"/, /class="[^"]*contact[^"]*"/],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timestamp() {
  return new Date().toISOString();
}

// Collect all CSS source: either from /src/styles/*.css or from <style> blocks in the HTML.
function collectCssSources(html) {
  const sources = [];

  // From src/styles/ directory
  if (fs.existsSync(STYLES_DIR)) {
    const cssFiles = fs.readdirSync(STYLES_DIR).filter(f => f.endsWith('.css'));
    for (const f of cssFiles) {
      sources.push({
        origin: path.join(STYLES_DIR, f),
        content: fs.readFileSync(path.join(STYLES_DIR, f), 'utf8'),
      });
    }
  }

  // From inline <style> blocks in the built HTML
  const styleBlocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)];
  for (const [, content] of styleBlocks) {
    sources.push({ origin: 'output/index.html <style>', content });
  }

  return sources;
}

// ─── A. TOKEN ENFORCEMENT ─────────────────────────────────────────────────────

function checkTokens(html) {
  console.log('── A. Token Enforcement ─────────────────────────────────────');

  const stylesExist = fs.existsSync(STYLES_DIR);
  if (!stylesExist) {
    console.log(`  ⚠ src/styles/ directory not found — checking inline CSS in output/index.html`);
  }

  const cssSources = collectCssSources(html);
  const allCss = cssSources.map(s => s.content).join('\n');

  const results = [];

  for (const token of REQUIRED_TOKENS) {
    // Check definition: --token-name: ...
    const defined = allCss.includes(`${token.name}:`);
    // Check usage: var(--token-name)
    const used = allCss.includes(`var(${token.name})`);

    const status = defined && used ? 'OK' : defined ? 'DEFINED_NOT_USED' : used ? 'USED_NOT_DEFINED' : 'MISSING';
    results.push({ ...token, defined, used, status });

    const icon = status === 'OK' ? '✓' : '✗';
    const note = status === 'OK'
      ? 'defined and used'
      : status === 'DEFINED_NOT_USED' ? 'defined but never used via var()'
      : status === 'USED_NOT_DEFINED' ? 'used via var() but never defined'
      : 'not found anywhere';
    console.log(`  ${icon} ${token.name.padEnd(24)} ${note}`);
  }

  const missing = results.filter(r => r.status === 'MISSING');
  const partial = results.filter(r => r.status !== 'OK' && r.status !== 'MISSING');

  if (!stylesExist) {
    console.log(`\n  NOTE: CSS is embedded in build.js / output HTML, not in src/styles/.`);
    console.log(`  Consider migrating to a dedicated src/styles/tokens.css file.\n`);
  }

  console.log(`  ${missing.length} token(s) missing, ${partial.length} partial issue(s)\n`);
  return { results, stylesExist, cssSources: cssSources.map(s => s.origin) };
}

// ─── B. EM-DASH GUARD ─────────────────────────────────────────────────────────

function checkEmDash(html) {
  console.log('── B. Em-Dash Guard ─────────────────────────────────────────');

  // U+2014 em-dash character
  const EM_DASH = '—';
  const occurrences = [];

  // Check outside of <style> and <script> blocks (content only)
  const contentOnly = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');

  let idx = 0;
  while ((idx = contentOnly.indexOf(EM_DASH, idx)) !== -1) {
    const start   = Math.max(0, idx - 40);
    const end     = Math.min(contentOnly.length, idx + 41);
    const context = contentOnly.slice(start, end).replace(/\n/g, ' ').trim();
    occurrences.push({ index: idx, context });
    idx++;
  }

  if (occurrences.length === 0) {
    console.log('  ✓ No em-dashes found in rendered content — CLEAN\n');
  } else {
    console.error(`  ✗ CRITICAL: ${occurrences.length} em-dash(es) found in output/index.html`);
    for (const o of occurrences) {
      console.error(`    ...${o.context}...`);
    }
    console.log('');
  }

  return { count: occurrences.length, occurrences, critical: occurrences.length > 0 };
}

// ─── C. MOBILE CHECK ──────────────────────────────────────────────────────────

function checkMobile(html) {
  console.log('── C. Mobile Check ──────────────────────────────────────────');
  const issues = [];

  // Viewport meta tag
  if (/<meta[^>]+name=["']viewport["'][^>]*>/i.test(html)) {
    console.log('  ✓ Viewport meta tag present');
  } else {
    issues.push({ severity: 'CRITICAL', message: 'Missing viewport meta tag' });
    console.error('  ✗ CRITICAL: Missing viewport meta tag');
  }

  // Fixed widths above 768px on block elements.
  // Scan inline style attributes and CSS for width: <N>px where N > 768.
  const fixedWidthRe = /width\s*:\s*(\d+)px/g;
  const cssOnly = html.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (_, css) => css)
    .replace(/<[^>]+>/g, ''); // strip tags from non-style content

  // Check in CSS blocks
  const cssBlocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]).join('\n');
  let m;
  const re = new RegExp(fixedWidthRe.source, 'g');
  while ((m = re.exec(cssBlocks)) !== null) {
    const px = parseInt(m[1], 10);
    if (px > 768) {
      const start   = Math.max(0, m.index - 60);
      const end     = Math.min(cssBlocks.length, m.index + m[0].length + 60);
      const context = cssBlocks.slice(start, end).replace(/\n/g, ' ').trim();
      // Only flag hard `width:` declarations, not max-width or min-width
      const before = cssBlocks.slice(Math.max(0, m.index - 10), m.index);
      if (!/max-|min-/.test(before)) {
        issues.push({ severity: 'WARNING', message: `Fixed width ${px}px > 768px in CSS: ...${context}...` });
        console.warn(`  ⚠ Fixed width ${px}px > 768px — ...${context.slice(0, 80)}...`);
      }
    }
  }

  // Check inline style attributes for fixed widths
  const inlineStyleRe = /style="[^"]*width\s*:\s*(\d+)px[^"]*"/g;
  let im;
  while ((im = inlineStyleRe.exec(html)) !== null) {
    const px = parseInt(im[1], 10);
    if (px > 768) {
      issues.push({ severity: 'WARNING', message: `Inline fixed width ${px}px > 768px: ${im[0].slice(0, 80)}` });
      console.warn(`  ⚠ Inline fixed width ${px}px > 768px`);
    }
  }

  // Images: all <img> tags should have max-width: 100% or width="100%" or inline max-width
  const imgTags = [...html.matchAll(/<img[^>]+>/gi)];
  for (const [tag] of imgTags) {
    const hasMaxWidth = /max-width\s*:\s*100%/.test(tag) || /style="[^"]*max-width/.test(tag);
    const hasWidthAttr = /width=["']100%["']/.test(tag);
    if (!hasMaxWidth && !hasWidthAttr) {
      issues.push({ severity: 'WARNING', message: `Image missing max-width: 100%: ${tag.slice(0, 80)}` });
      console.warn(`  ⚠ Image without max-width: 100%: ${tag.slice(0, 80)}`);
    }
  }

  const warnings = issues.filter(i => i.severity === 'WARNING');
  const criticals = issues.filter(i => i.severity === 'CRITICAL');

  if (warnings.length === 0 && criticals.length === 0) {
    console.log('  ✓ No mobile issues found');
  }
  console.log(`  ${imgTags.length} image(s) checked\n`);

  return { issues, imgCount: imgTags.length };
}

// ─── D. COMPONENT AUDIT ───────────────────────────────────────────────────────

function checkComponents(html) {
  console.log('── D. Component Audit ───────────────────────────────────────');
  const results = [];

  for (const component of REQUIRED_COMPONENTS) {
    const found = component.patterns.some(pattern => pattern.test(html));
    results.push({ name: component.name, found });

    if (found) {
      console.log(`  ✓ ${component.name}`);
    } else {
      console.error(`  ✗ CRITICAL: ${component.name} — not found in output/index.html`);
    }
  }

  const missing = results.filter(r => !r.found);
  console.log(`\n  ${results.length - missing.length}/${results.length} components present\n`);
  return { results, missingCount: missing.length };
}

// ─── REPORT ───────────────────────────────────────────────────────────────────

function writeReport({ run, tokens, emDash, mobile, components }) {
  const criticals = [];
  const warnings  = [];

  // Token issues
  for (const t of tokens.results) {
    if (t.status === 'MISSING') {
      warnings.push(`Token \`${t.name}\` (${t.purpose}) not found in CSS`);
    } else if (t.status !== 'OK') {
      warnings.push(`Token \`${t.name}\`: ${t.status.toLowerCase().replace(/_/g, ' ')}`);
    }
  }

  // Em-dash
  if (emDash.critical) {
    criticals.push(`${emDash.count} em-dash character(s) found in rendered content`);
  }

  // Mobile
  for (const issue of mobile.issues) {
    if (issue.severity === 'CRITICAL') criticals.push(issue.message);
    else warnings.push(issue.message);
  }

  // Components
  for (const c of components.results) {
    if (!c.found) criticals.push(`Missing component: ${c.name}`);
  }

  const overallPass = criticals.length === 0;

  const lines = [
    `---`,
    `agent: design-ux-agent`,
    `run: ${run}`,
    `passed: ${overallPass}`,
    `criticals: ${criticals.length}`,
    `warnings: ${warnings.length}`,
    `---`,
    ``,
    `# Design/UX Agent Report`,
    ``,
    `**Run:** ${run}`,
    `**Status:** ${overallPass ? '✓ PASSED' : '✗ FAILED — ' + criticals.length + ' critical issue(s)'}`,
    ``,
    `---`,
    ``,
    `## A. Token Enforcement`,
    ``,
    tokens.stylesExist
      ? `Checked CSS files in \`src/styles/\``
      : `⚠ \`src/styles/\` directory not found. CSS is embedded in \`build.js\` / \`output/index.html\`. Consider extracting to a dedicated token file.`,
    ``,
    `Sources scanned:`,
    ...tokens.cssSources.map(s => `- \`${s}\``),
    ``,
    `| Token | Purpose | Status |`,
    `|-------|---------|--------|`,
    ...tokens.results.map(t => {
      const status = t.status === 'OK' ? '✓ OK'
        : t.status === 'MISSING' ? '✗ Missing'
        : t.status === 'DEFINED_NOT_USED' ? '⚠ Defined, not used'
        : '⚠ Used, not defined';
      return `| \`${t.name}\` | ${t.purpose} | ${status} |`;
    }),
    ``,
    `---`,
    ``,
    `## B. Em-Dash Guard`,
    ``,
    emDash.critical
      ? `**CRITICAL:** ${emDash.count} em-dash(es) found in rendered content. Zero tolerance policy violated.`
      : `✓ No em-dashes found in rendered content.`,
    ``,
  ];

  if (emDash.occurrences.length > 0) {
    lines.push(`| # | Context |`, `|---|---------|`);
    emDash.occurrences.forEach((o, i) => {
      lines.push(`| ${i + 1} | \`...${o.context.replace(/\|/g, '/').slice(0, 80)}...\` |`);
    });
    lines.push(``);
  }

  lines.push(
    `---`,
    ``,
    `## C. Mobile Check`,
    ``,
    `| Check | Result |`,
    `|-------|--------|`,
    `| Viewport meta tag | ${mobile.issues.some(i => i.message.includes('viewport')) ? '✗ Missing' : '✓ Present'} |`,
    `| Fixed widths > 768px | ${mobile.issues.filter(i => i.message.includes('width')).length === 0 ? '✓ None found' : '⚠ Violations present'} |`,
    `| Images max-width | ${mobile.imgCount === 0 ? '✓ No images (N/A)' : mobile.issues.filter(i => i.message.includes('Image')).length === 0 ? '✓ All compliant' : '⚠ Violations present'} |`,
    ``,
  );

  if (mobile.issues.length > 0) {
    lines.push(`**Issues:**`);
    for (const issue of mobile.issues) {
      lines.push(`- **${issue.severity}:** ${issue.message}`);
    }
    lines.push(``);
  }

  lines.push(
    `---`,
    ``,
    `## D. Component Audit`,
    ``,
    `| Component | Status |`,
    `|-----------|--------|`,
    ...components.results.map(c => `| ${c.name} | ${c.found ? '✓ Present' : '✗ CRITICAL — Not found'} |`),
    ``,
  );

  if (criticals.length > 0) {
    lines.push(
      `---`,
      ``,
      `## Critical Issues`,
      ``,
      ...criticals.map(c => `- ✗ **CRITICAL:** ${c}`),
      ``,
    );
  }

  if (warnings.length > 0) {
    lines.push(
      `---`,
      ``,
      `## Warnings`,
      ``,
      ...warnings.map(w => `- ⚠ ${w}`),
      ``,
    );
  }

  lines.push(
    `---`,
    ``,
    overallPass
      ? `> All critical checks passed. Ready for deployment.`
      : `> **Action required:** Fix ${criticals.length} critical issue(s) before deployment.`,
    ``,
  );

  return lines.join('\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const run = timestamp();
  console.log(`Design/UX Agent — ${run}\n`);

  if (DRY_RUN) {
    console.log('  [DRY RUN] Would check:');
    console.log('    A. Token enforcement against src/styles/ and output/index.html');
    console.log('    B. Em-dash guard on output/index.html');
    console.log('    C. Mobile check on output/index.html');
    console.log('    D. Component audit on output/index.html');
    console.log('  [DRY RUN] Would write: handoff/design-ux-report.md\n');
    return;
  }

  if (!fs.existsSync(OUTPUT_HTML)) {
    console.error(`  ✗ output/index.html not found. Run website-architect first.\n`);
    process.exit(1);
  }

  const html = fs.readFileSync(OUTPUT_HTML, 'utf8');

  const tokens    = checkTokens(html);
  const emDash    = checkEmDash(html);
  const mobile    = checkMobile(html);
  const components = checkComponents(html);

  const criticals = [
    ...(emDash.critical ? [true] : []),
    ...components.results.filter(c => !c.found),
    ...mobile.issues.filter(i => i.severity === 'CRITICAL'),
  ];

  const md = writeReport({ run, tokens, emDash, mobile, components });

  if (!fs.existsSync(HANDOFF_DIR)) fs.mkdirSync(HANDOFF_DIR, { recursive: true });
  fs.writeFileSync(REPORT_PATH, md, 'utf8');

  console.log(`── Report ───────────────────────────────────────────────────`);
  console.log(`  Written to handoff/design-ux-report.md`);
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  Status: ${criticals.length === 0 ? '✓ PASSED' : '✗ FAILED — ' + criticals.length + ' critical issue(s)'}`);
  console.log(`${'─'.repeat(60)}\n`);

  process.exit(criticals.length === 0 ? 0 : 1);
}

main();
