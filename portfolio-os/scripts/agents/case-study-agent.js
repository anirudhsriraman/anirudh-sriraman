#!/usr/bin/env node
/**
 * case-study-agent.js
 * Five capabilities: validate, score, cross-check, scaffold, report.
 *
 * Usage:
 *   node scripts/agents/case-study-agent.js
 *   node scripts/agents/case-study-agent.js --new "case-study-title"
 *
 * Outputs:
 *   handoff/case-study-agent-report.md
 *   handoff/metric-conflicts.md
 *   Writes audience scores to each case study's frontmatter.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ─── Paths ────────────────────────────────────────────────────────────────────

const ROOT         = path.resolve(__dirname, '../..');
const CASE_STUDIES = path.join(ROOT, 'content', 'case-studies');
const PROFILE_MD   = path.join(ROOT, 'content', 'profile.md');
const HANDOFF_DIR  = path.join(ROOT, 'handoff');

// ─── Frontmatter ──────────────────────────────────────────────────────────────

function parseFrontmatter(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };

  const meta = {};
  match[1].split('\n').forEach(line => {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) return;
    const key   = line.slice(0, colonIdx).trim();
    let value   = line.slice(colonIdx + 1).trim();
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

// Inject score fields into raw frontmatter string without disturbing other fields.
function injectScores(raw, scores) {
  // Remove any previously written score lines
  let updated = raw.replace(/^scores_\w+:.*\n/gm, '');

  const scoreBlock = [
    `scores_founder_ceo: ${scores.founder_ceo}`,
    `scores_recruiter: ${scores.recruiter}`,
    `scores_vp_product: ${scores.vp_product}`,
    `scores_vp_ai: ${scores.vp_ai}`,
    `scores_vp_dx: ${scores.vp_dx}`,
    `scores_vp_cx: ${scores.vp_cx}`,
  ].join('\n');

  // Insert before the closing --- of frontmatter
  updated = updated.replace(/^(---\n[\s\S]*?)(^---)/m, (_, fm, close) => {
    return `${fm.trimEnd()}\n${scoreBlock}\n${close}`;
  });

  return updated;
}

function readMd(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return { ...parseFrontmatter(raw), raw, filePath };
}

function relPath(p) {
  return path.relative(ROOT, p);
}

// ─── VALIDATE ─────────────────────────────────────────────────────────────────
// All four section names must appear as ## headings (case-insensitive).

const REQUIRED_SECTIONS = ['Context', 'Decision', 'Action', 'Outcome'];

function validateCaseStudy(file) {
  const missing = REQUIRED_SECTIONS.filter(section => {
    const re = new RegExp(`^##\\s+${section}\\b`, 'im');
    return !re.test(file.body);
  });
  return { missing, pass: missing.length === 0 };
}

// ─── SCORE ────────────────────────────────────────────────────────────────────
// Each of 6 personas scored 0–3 based on three independent signal groups.

function scoreFile(file) {
  const metricsText = Array.isArray(file.meta.metrics) ? file.meta.metrics.join(' ') : '';
  const tagsText    = Array.isArray(file.meta.tags) ? file.meta.tags.join(' ') : '';
  const full        = `${file.body} ${metricsText} ${tagsText}`.toLowerCase();

  // founder-ceo (0-3): zero-to-one/startup-to-scale, AI commercialisation, full ownership (P&L/strategy/execution)
  const founderCeo = [
    /zero.to.one|startup.to.scale|zero.to.one|built from scratch|from scratch|greenfield|new product|no existing/.test(full),
    /\bai\b.*commerci|commerci.*\bai\b|ai product|ai platform|ai.*revenue|revenue.*ai|agentic|llm\b|path.*arr\b/.test(full),
    /p&l|full ownership|strategy.*execution|execution.*strategy|own.*roadmap.*delivery|portfolio governance|jtbd|validation research/.test(full),
  ].filter(Boolean).length;

  // recruiter (0-3): 2+ hard metrics, team scale (explicit headcount number only), standard PM competency
  // Specificity rule: headcount must be stated as an explicit number — implied scale ("org design", "headcount") does not count.
  const recruiter = [
    (() => { const m = full.match(/\d[\d,.]*%|\$[\d,.]+[kmb]?|\d+[kmb]\+?\b/g); return m && m.length >= 2; })(),
    /\d+\s*engineers?|\d+\s*pms?|led\s+\d+|team of \d+/.test(full),
    /win rate|rfp\b|roadmap|discovery|stakeholder|go-to-market|launch|product strategy|product-market/.test(full),
  ].filter(Boolean).length;

  // vp-product (0-3): roadmap/portfolio governance, cross-functional leadership, commercial outcome
  const vpProduct = [
    /roadmap|portfolio governance|prioriti|backlog|sprint planning|product strategy|scope/.test(full),
    /cross.functional|engineering.*partner|design.*partner|partnered with|worked with.*team|led.*teams|career ladder|org design/.test(full),
    /revenue|win rate|pipeline|\$[\d]|arr\b|commercial|deal|upsell|conversion|growth/.test(full),
  ].filter(Boolean).length;

  // vp-ai (0-3): AI/ML/NLP/LLM deployment, accuracy/governance/human-in-the-loop, regulated/enterprise market
  const vpAi = [
    /\bai\b|artificial intelligence|machine.?learning|\bml\b|nlp\b|natural language|llm\b|agentic|deep.?learning/.test(full),
    /accura|governance|human.in.the.loop|annotation|inter-annotator|bias|explainab|audit trail/.test(full),
    /regulated|enterprise|government|gov(t|ernment)|telecom|banking|insurance|healthcare|compliance/.test(full),
  ].filter(Boolean).length;

  // vp-dx (0-3): change management/adoption/process redesign, org readiness/training, Govt/Telco/Retail/Hospitality sector
  const vpDx = [
    /change management|adoption|process redesign|transform|restructur|inheriting|transition|shift/.test(full),
    /org readiness|training|onboard|psychological safety|enablement|change.?readiness|attrition|resignation/.test(full),
    /government|gov(t|ernment)|telecom|retail|hospitality|public sector/.test(full),
  ].filter(Boolean).length;

  // vp-cx (0-3): VoC/NPS/CSAT/feedback programs, retention/churn/customer health, CX-to-revenue connection
  const vpCx = [
    /\bvoc\b|voice of (the )?customer|nps\b|csat\b|feedback program|survey|sentiment/.test(full),
    /retention|churn|customer health|attrition|upsell|renewal|lifetime value/.test(full),
    /cx.*revenue|revenue.*cx|cx.*commercial|commercial.*cx|csat.*improvement|nps.*improvement|cx.*platform/.test(full),
  ].filter(Boolean).length;

  return {
    founder_ceo: Math.min(founderCeo, 3),
    recruiter:   Math.min(recruiter, 3),
    vp_product:  Math.min(vpProduct, 3),
    vp_ai:       Math.min(vpAi, 3),
    vp_dx:       Math.min(vpDx, 3),
    vp_cx:       Math.min(vpCx, 3),
  };
}

// ─── CROSS-CHECK ──────────────────────────────────────────────────────────────
// Extract numeric metric tokens and compare case study bodies against profile.md.

const METRIC_RE = /\$[\d,.]+[KMBb]?|\d[\d,]*\.?\d*%|\d[\d,.]*[KMBb]\+?\b|\b\d{2,}[KMBb]?\+?\b/gi;

function extractMetricTokens(text) {
  const results = [];
  let m;
  const re = new RegExp(METRIC_RE.source, 'gi');
  while ((m = re.exec(text)) !== null) {
    results.push({ value: m[0], index: m.index });
  }
  return results;
}

function normalise(s) {
  return s.toLowerCase().replace(/[,\s+]/g, '');
}

// Reduce a metric string to a plain number for fuzzy comparison.
// Returns null if the string can't be parsed as a number.
function toBaseNumber(s) {
  let t = s.toLowerCase().replace(/[,\s+$]/g, '');
  t = t.replace(/million/g, 'm').replace(/billion/g, 'b').replace(/thousand/g, 'k');
  const m = t.match(/^(\d+\.?\d*)(k|m|b)?(%?)$/);
  if (!m) return null;
  let n = parseFloat(m[1]);
  if (m[2] === 'k') n *= 1000;
  else if (m[2] === 'm') n *= 1_000_000;
  else if (m[2] === 'b') n *= 1_000_000_000;
  return n;
}

// Parse the ## Metrics registry from profile body into a Set of normalised values
// and a Map of base-number → original registry value for fuzzy matching.
function buildMetricsRegistry(profileFile) {
  const normSet   = new Set(extractMetricTokens(profileFile.raw).map(m => normalise(m.value)));
  const baseMap   = new Map(); // base number → registry value string

  const lines = profileFile.body.split('\n');
  let inMetrics = false;
  for (const line of lines) {
    if (/^##\s+Metrics/.test(line)) { inMetrics = true; continue; }
    if (inMetrics && /^##\s/.test(line)) break;
    if (!inMetrics) continue;
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (!value) continue;
    const base = toBaseNumber(value);
    if (base !== null) baseMap.set(base, value);
  }

  return { normSet, baseMap };
}

function crossCheck(caseStudyFiles, profileFile) {
  const { normSet, baseMap } = buildMetricsRegistry(profileFile);

  const conflicts = [];

  for (const file of caseStudyFiles) {
    const tokens = extractMetricTokens(file.body);

    for (const token of tokens) {
      if (normSet.has(normalise(token.value))) continue;

      const start   = Math.max(0, token.index - 50);
      const end     = Math.min(file.body.length, token.index + token.value.length + 50);
      const context = file.body.slice(start, end).replace(/\n/g, ' ').trim();

      // Check if same numeric value with different formatting → WARNING
      const base = toBaseNumber(token.value);
      const isWarning = base !== null && baseMap.has(base);

      conflicts.push({
        file:     relPath(file.filePath),
        metric:   token.value,
        context:  `...${context}...`,
        severity: isWarning ? 'WARNING' : 'CRITICAL',
        note:     isWarning
          ? `Close match to "${baseMap.get(base)}" in registry — different format, same value`
          : 'Not found in profile.md — add to profile.md if canonical',
      });
    }
  }

  return conflicts;
}

// ─── SCAFFOLD ─────────────────────────────────────────────────────────────────

function scaffold(title) {
  const slug     = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const filePath = path.join(CASE_STUDIES, `${slug}.md`);

  if (fs.existsSync(filePath)) {
    console.error(`  ✗ File already exists: ${relPath(filePath)}`);
    process.exit(1);
  }

  const content = [
    `---`,
    `title: "${title}"`,
    `slug: "${slug}"`,
    `audience: [recruiter, cpo, dx]`,
    `metrics: []`,
    `tags: []`,
    `priority: 99`,
    `status: draft`,
    `scores_founder_ceo: 0`,
    `scores_recruiter: 0`,
    `scores_vp_product: 0`,
    `scores_vp_ai: 0`,
    `scores_vp_dx: 0`,
    `scores_vp_cx: 0`,
    `---`,
    ``,
    `# ${title}`,
    ``,
    `**Metrics:** [add key metrics here]`,
    ``,
    `## Context`,
    ``,
    `[Describe the situation before you acted. What was broken, missing, or at risk?]`,
    ``,
    `## Decision`,
    ``,
    `[Describe the specific choice you made and what you decided not to do.]`,
    ``,
    `## Action`,
    ``,
    `[Describe what you concretely did. Be specific: who, what, sequence.]`,
    ``,
    `## Outcome`,
    ``,
    `[Quantified results. Real numbers. What changed as a direct result of this work?]`,
  ].join('\n');

  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`  ✓ Scaffolded: ${relPath(filePath)}`);
  return filePath;
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function wordCount(body) {
  return body.split(/\s+/).filter(w => w.length > 0).length;
}

function readingTime(words) {
  return Math.ceil(words / 200);
}

// ─── REPORT ───────────────────────────────────────────────────────────────────

function writeReport({ validations, scores, conflicts, wordCounts, run }) {
  const allPass = validations.every(v => v.pass);

  const lines = [
    `---`,
    `agent: case-study-agent`,
    `run: ${run}`,
    `passed: ${allPass}`,
    `---`,
    ``,
    `# Case Study Agent Report`,
    ``,
    `**Run:** ${run}`,
    `**Status:** ${allPass ? '✓ ALL PASSED' : '✗ VALIDATION FAILURES PRESENT'}`,
    ``,
    `---`,
    ``,
    `## 1. Validation`,
    ``,
    `Required sections (exact ## heading): **Context · Decision · Action · Outcome**`,
    ``,
    `| File | Status | Missing Sections |`,
    `|------|--------|------------------|`,
  ];

  for (const v of validations) {
    const status  = v.pass ? '✓ PASS' : '✗ FAIL';
    const missing = v.missing.length ? v.missing.join(', ') : '—';
    const name    = path.basename(v.file);
    lines.push(`| ${name} | ${status} | ${missing} |`);
  }

  lines.push(
    ``,
    `---`,
    ``,
    `## 2. Audience Fit Scores`,
    ``,
    `Scoring signals (each persona 0–3):`,
    `- **founder-ceo:** zero-to-one/startup-to-scale, AI commercialisation, full P&L/strategy/execution ownership`,
    `- **recruiter:** 2+ hard metrics, team scale (explicit headcount number required), standard PM competency`,
    `- **vp-product:** roadmap/portfolio governance, cross-functional leadership, commercial outcome`,
    `- **vp-ai:** AI/ML/NLP/LLM deployment, accuracy/governance/human-in-the-loop, regulated/enterprise market`,
    `- **vp-dx:** change management/adoption/process redesign, org readiness/training, Govt/Telco/Retail/Hospitality`,
    `- **vp-cx:** VoC/NPS/CSAT/feedback programs, retention/churn/customer health, CX-to-revenue connection`,
    ``,
    `| Case Study | founder-ceo | recruiter | vp-product | vp-ai | vp-dx | vp-cx | Top Audience |`,
    `|---|---|---|---|---|---|---|---|`,
  );

  for (const s of scores) {
    const name = path.basename(s.file);
    const sc   = s.scores;
    const entries = [
      ['founder-ceo', sc.founder_ceo],
      ['recruiter',   sc.recruiter],
      ['vp-product',  sc.vp_product],
      ['vp-ai',       sc.vp_ai],
      ['vp-dx',       sc.vp_dx],
      ['vp-cx',       sc.vp_cx],
    ];
    // Penalty rule: recruiter only wins top-audience if no non-recruiter persona matches or exceeds
    // its score. When any non-recruiter persona scores >= recruiter (and > 0), the higher-specificity
    // persona wins — even in a tie. This prevents recruiter from dominating stories that have a
    // clear specialist signal.
    const nonRecruiterEntries = entries.filter(([p]) => p !== 'recruiter');
    const nonRecruiterMax = nonRecruiterEntries.reduce((max, [, v]) => Math.max(max, v), 0);
    const topNonRecruiter  = nonRecruiterEntries.find(([, v]) => v === nonRecruiterMax);
    const top = (topNonRecruiter && topNonRecruiter[1] >= sc.recruiter && topNonRecruiter[1] > 0)
      ? topNonRecruiter[0]
      : entries.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
    lines.push(`| ${name} | ${sc.founder_ceo}/3 | ${sc.recruiter}/3 | ${sc.vp_product}/3 | ${sc.vp_ai}/3 | ${sc.vp_dx}/3 | ${sc.vp_cx}/3 | ${top} |`);
  }

  lines.push(
    ``,
    `---`,
    ``,
    `## 3. Metric Cross-Check vs profile.md`,
    ``,
    `Flags numeric tokens in case study bodies not found verbatim in profile.md.`,
    `These are not necessarily errors — profile.md may need expanding to cover all canonical metrics.`,
    `Full list written to \`handoff/metric-conflicts.md\`.`,
    ``,
  );

  if (conflicts.length === 0) {
    lines.push(`**No conflicts.** All case study metrics appear in profile.md.`);
  } else {
    const criticals = conflicts.filter(c => c.severity === 'CRITICAL');
    const warnings  = conflicts.filter(c => c.severity === 'WARNING');
    lines.push(`**${criticals.length} CRITICAL** · **${warnings.length} WARNING** metric token(s) flagged.`);
    lines.push(``, `| Severity | File | Metric | Note |`, `|----------|------|--------|------|`);
    for (const c of conflicts) {
      const name = path.basename(c.file);
      const note = c.note.replace(/\|/g, '/').slice(0, 80);
      lines.push(`| ${c.severity} | ${name} | \`${c.metric}\` | ${note} |`);
    }
  }

  lines.push(
    ``,
    `---`,
    ``,
    `## 4. Word Count & Reading Time`,
    ``,
    `| File | Words | Reading Time |`,
    `|------|------:|:------------:|`,
  );

  for (const w of wordCounts) {
    const name = path.basename(w.file);
    lines.push(`| ${name} | ${w.words} | ~${w.readingTime} min |`);
  }

  lines.push(``, `---`, ``);

  if (!allPass) {
    lines.push(`> **Action required:** Fix missing sections in failing case studies before the website-architect step.`);
  } else {
    lines.push(`> All case studies passed validation. Ready for website-architect.`);
  }

  const md         = lines.join('\n');
  const reportPath = path.join(HANDOFF_DIR, 'case-study-agent-report.md');
  if (!fs.existsSync(HANDOFF_DIR)) fs.mkdirSync(HANDOFF_DIR, { recursive: true });
  fs.writeFileSync(reportPath, md, 'utf8');
  return reportPath;
}

function writeConflictsFile(conflicts) {
  if (!fs.existsSync(HANDOFF_DIR)) fs.mkdirSync(HANDOFF_DIR, { recursive: true });

  const lines = [
    `# Metric Conflicts — case-study-agent`,
    ``,
    `Numeric tokens found in case study bodies that are absent from profile.md.`,
    ``,
    `**Resolution:** For each entry, either:`,
    `- Add the metric to profile.md so it becomes a canonical anchor, or`,
    `- Confirm it is intentionally case-study-only and dismiss.`,
    ``,
  ];

  if (conflicts.length === 0) {
    lines.push(`No conflicts found.`);
  } else {
    let lastFile = null;
    for (const c of conflicts) {
      if (c.file !== lastFile) {
        lines.push(`## ${c.file}`, ``);
        lastFile = c.file;
      }
      const badge = c.severity === 'WARNING' ? '⚠ WARNING' : '✗ CRITICAL';
      lines.push(`- ${badge} **\`${c.metric}\`** — ${c.note}`);
      lines.push(`  > ${c.context}`);
    }
  }

  fs.writeFileSync(path.join(HANDOFF_DIR, 'metric-conflicts.md'), lines.join('\n'), 'utf8');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const args    = process.argv.slice(2);
  const newIdx  = args.indexOf('--new');

  if (newIdx !== -1) {
    const title = args[newIdx + 1];
    if (!title) {
      console.error('  ✗ --new requires a title: node case-study-agent.js --new "My Case Study"');
      process.exit(1);
    }
    console.log(`Case Study Agent — scaffold "${title}"\n`);
    scaffold(title);
    return;
  }

  const run = new Date().toISOString();
  console.log(`Case Study Agent — ${run}\n`);

  if (!fs.existsSync(CASE_STUDIES)) {
    console.error(`  ✗ Not found: ${CASE_STUDIES}`);
    process.exit(1);
  }

  const files = fs.readdirSync(CASE_STUDIES)
    .filter(f => f.endsWith('.md'))
    .sort()
    .map(f => readMd(path.join(CASE_STUDIES, f)));

  const profileFile = readMd(PROFILE_MD);

  console.log(`  Case studies: ${files.length}`);
  console.log(`  Profile:      ${relPath(PROFILE_MD)}\n`);

  // ── 1. VALIDATE ──
  console.log('── 1. Validate ──────────────────────────────────────────────');
  const validations = [];
  let anyFail = false;

  for (const file of files) {
    const result = validateCaseStudy(file);
    const label  = relPath(file.filePath);
    validations.push({ file: label, ...result });

    if (result.pass) {
      console.log(`  ✓ ${label}`);
    } else {
      anyFail = true;
      console.error(`  ✗ ${label}`);
      console.error(`    MISSING: ${result.missing.join(', ')}`);
    }
  }

  if (anyFail) {
    console.error(`\n  !! VALIDATION FAILURES — missing required sections in one or more files\n`);
  } else {
    console.log(`\n  All files passed validation.\n`);
  }

  // ── 2. SCORE ──
  console.log('── 2. Score ─────────────────────────────────────────────────');
  const scoreResults = [];

  for (const file of files) {
    const scores = scoreFile(file);
    const label  = relPath(file.filePath);
    scoreResults.push({ file: label, scores });

    // Write scores into frontmatter
    const updated = injectScores(file.raw, scores);
    fs.writeFileSync(file.filePath, updated, 'utf8');

    console.log(`  ${path.basename(label).padEnd(32)} founder-ceo=${scores.founder_ceo}/3  recruiter=${scores.recruiter}/3  vp-product=${scores.vp_product}/3  vp-ai=${scores.vp_ai}/3  vp-dx=${scores.vp_dx}/3  vp-cx=${scores.vp_cx}/3`);
  }

  // ── 3. CROSS-CHECK ──
  console.log('\n── 3. Cross-Check vs profile.md ─────────────────────────────');
  const conflicts = crossCheck(files, profileFile);
  writeConflictsFile(conflicts);

  if (conflicts.length === 0) {
    console.log('  ✓ No conflicts — all case study metrics found in profile.md');
  } else {
    const criticals = conflicts.filter(c => c.severity === 'CRITICAL');
    const warnings  = conflicts.filter(c => c.severity === 'WARNING');
    console.log(`  ${criticals.length} CRITICAL · ${warnings.length} WARNING metric token(s) flagged`);
    console.log(`  Written to handoff/metric-conflicts.md`);
  }

  // ── 4. WORD COUNTS ──
  const wordCounts = files.map(file => {
    const words = wordCount(file.body);
    return { file: relPath(file.filePath), words, readingTime: readingTime(words) };
  });

  // ── 5. REPORT ──
  console.log('\n── 5. Report ────────────────────────────────────────────────');
  const reportPath = writeReport({ validations, scores: scoreResults, conflicts, wordCounts, run });
  console.log(`  Written to ${relPath(reportPath)}`);

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  Status: ${anyFail ? '✗ FAILED — fix validation errors before website build' : '✓ PASSED'}`);
  console.log(`${'─'.repeat(60)}\n`);

  process.exit(anyFail ? 1 : 0);
}

main();
