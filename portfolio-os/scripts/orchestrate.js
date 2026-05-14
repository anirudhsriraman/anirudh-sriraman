#!/usr/bin/env node
/**
 * orchestrate.js — Portfolio OS pipeline runner
 *
 * Usage:
 *   node scripts/orchestrate.js --mode=build            run full pipeline once
 *   node scripts/orchestrate.js --mode=build --dry-run  print pipeline steps, do not execute
 *   node scripts/orchestrate.js --mode=watch            watch /content/ and re-run on change
 *   node scripts/orchestrate.js --mode=audit            run content-strategist only
 *
 * Pipeline order (build mode):
 *   content-strategist → case-study-agent → dynamic-content-agent → website-architect → design-ux-agent → qa
 */

'use strict';

const fs             = require('fs');
const path           = require('path');
const { execFileSync, spawnSync } = require('child_process');

// ─── Paths ────────────────────────────────────────────────────────────────────

const ROOT        = path.resolve(__dirname, '..');
const AGENTS      = path.join(__dirname, 'agents');
const CONTENT     = path.join(ROOT, 'content');
const HANDOFF     = path.join(ROOT, 'handoff');
const SCRIPTS     = __dirname;
const OUTPUT_HTML = path.join(ROOT, 'output', 'index.html');

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const modeArg = args.find(a => a.startsWith('--mode='));
const MODE    = modeArg ? modeArg.replace('--mode=', '') : 'build';
const FORCE   = args.includes('--force');
const DRY_RUN = args.includes('--dry-run');
const SKIP_QA = args.includes('--skip-qa');

if (!['build', 'watch', 'audit'].includes(MODE)) {
  console.error(`Unknown mode: "${MODE}". Use --mode=build | --mode=watch | --mode=audit`);
  process.exit(1);
}

// ─── Runner ───────────────────────────────────────────────────────────────────

function timestamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function banner(text) {
  const line = '─'.repeat(60);
  console.log(`\n${line}`);
  console.log(`  ${text}`);
  console.log(`${line}\n`);
}

function runAgent(name, scriptPath, extraArgs = []) {
  if (DRY_RUN) {
    console.log(`  [dry-run] would run: ${name}`);
    return true;
  }

  const nodeArgs = [scriptPath, ...extraArgs];
  if (FORCE) nodeArgs.push('--force');

  console.log(`  ► ${name}`);
  const result = spawnSync(process.execPath, nodeArgs, { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`\n  ✗ ${name} failed (exit ${result.status})`);
    return false;
  }
  console.log(`  ✓ ${name} passed\n`);
  return true;
}

function runQA() {
  if (SKIP_QA) {
    console.warn('\n  ⚠ WARNING: QA Agent skipped via --skip-qa. Build is unverified.\n');
    return true;
  }

  if (DRY_RUN) {
    console.log('  [dry-run] would run: QA Agent (qa-agent.js)');
    return true;
  }

  const qaScript = path.join(AGENTS, 'qa-agent.js');
  if (!fs.existsSync(qaScript)) {
    console.log('  [qa] qa-agent.js not found — skipping QA step');
    return true;
  }
  console.log('  ► QA Agent');
  const result = spawnSync(process.execPath, [qaScript], { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`\n  ✗ QA Agent failed with CRITICAL findings — build blocked.`);
    console.error('  Review the latest qa-report-*.md in /reports/\n');
    return false;
  }
  console.log('  ✓ QA Agent passed\n');
  return true;
}

// ─── Pipeline ─────────────────────────────────────────────────────────────────

function runBuild() {
  banner(`Portfolio OS  •  build${DRY_RUN ? '  •  DRY RUN' : ''}  •  ${timestamp()}`);

  if (DRY_RUN) {
    console.log('  Pipeline steps that would execute:\n');
  }

  // Snapshot output before build so we can restore it if QA fails
  const outputSnapshot = (!DRY_RUN && fs.existsSync(OUTPUT_HTML))
    ? fs.readFileSync(OUTPUT_HTML)
    : null;

  const steps = [
    { name: 'Content Strategist',   script: path.join(AGENTS, 'content-strategist.js') },
    { name: 'Case Study Agent',     script: path.join(AGENTS, 'case-study-agent.js') },
    { name: 'Dynamic Content Agent',script: path.join(AGENTS, 'dynamic-content-agent.js') },
    { name: 'Website Architect',    script: path.join(AGENTS, 'website-architect.js') },
    { name: 'Design/UX Agent',      script: path.join(AGENTS, 'design-ux-agent.js') },
  ];

  for (const step of steps) {
    const ok = runAgent(step.name, step.script);
    if (!ok && !FORCE) {
      console.error(`Pipeline halted at: ${step.name}`);
      console.error('Fix issues and re-run, or pass --force to skip gate checks.\n');
      process.exit(1);
    }
  }

  // QA gate — CRITICAL failures restore previous output and block the build
  const qaOk = runQA();
  if (!qaOk) {
    if (!DRY_RUN) {
      if (outputSnapshot) {
        fs.writeFileSync(OUTPUT_HTML, outputSnapshot);
        console.error('  output/index.html restored to previous version.\n');
      } else if (fs.existsSync(OUTPUT_HTML)) {
        fs.unlinkSync(OUTPUT_HTML);
        console.error('  output/index.html removed (no prior version to restore).\n');
      }
    }
    console.error('Pipeline halted at QA. Fix CRITICAL issues before deploying.\n');
    process.exit(1);
  }

  if (DRY_RUN) {
    banner(`Dry run complete  •  ${timestamp()}`);
    console.log('  No files were modified.\n');
  } else {
    banner(`Build complete  •  ${timestamp()}`);
    console.log('  output/index.html is ready.\n');
  }
}

function runAudit() {
  banner(`Portfolio OS  •  audit  •  ${timestamp()}`);
  const ok = runAgent('Content Strategist', path.join(AGENTS, 'content-strategist.js'));

  const reportPath = path.join(HANDOFF, 'content-strategist-report.md');
  if (fs.existsSync(reportPath)) {
    console.log('\n--- Audit Report ---\n');
    console.log(fs.readFileSync(reportPath, 'utf8'));
  }

  process.exit(ok ? 0 : 1);
}

function runWatch() {
  banner(`Portfolio OS  •  watch  •  ${timestamp()}`);
  console.log(`  Watching ${path.relative(ROOT, CONTENT)} for changes...\n`);

  let debounceTimer = null;
  let running = false;

  function trigger(filename) {
    if (running) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      running = true;
      console.log(`\n  Change detected: ${filename}`);
      try {
        runBuildQuiet();
      } finally {
        // Keep running=true for 2 seconds after the build to absorb any
        // delayed fs.watch events from files written by the pipeline itself
        // (e.g. case-study-agent writes back to content/case-studies/*.md)
        setTimeout(() => { running = false; }, 2000);
      }
    }, 300);
  }

  function runBuildQuiet() {
    console.log(`\n[${timestamp()}] Re-running pipeline...\n`);

    const outputSnapshot = fs.existsSync(OUTPUT_HTML) ? fs.readFileSync(OUTPUT_HTML) : null;

    const steps = [
      { name: 'Content Strategist',    script: path.join(AGENTS, 'content-strategist.js') },
      { name: 'Case Study Agent',      script: path.join(AGENTS, 'case-study-agent.js') },
      { name: 'Dynamic Content Agent', script: path.join(AGENTS, 'dynamic-content-agent.js') },
      { name: 'Website Architect',     script: path.join(AGENTS, 'website-architect.js') },
      { name: 'Design/UX Agent',       script: path.join(AGENTS, 'design-ux-agent.js') },
    ];
    for (const step of steps) {
      const ok = runAgent(step.name, step.script);
      if (!ok) { console.error(`  Pipeline stopped at ${step.name}\n`); return; }
    }

    const qaOk = runQA();
    if (!qaOk) {
      if (outputSnapshot) {
        fs.writeFileSync(OUTPUT_HTML, outputSnapshot);
        console.error('  [watch] output/index.html restored — QA blocked this build.\n');
      }
      return;
    }
    console.log(`[${timestamp()}] Done — output/index.html updated.\n`);
  }

  // Run once immediately on start
  runBuildQuiet();

  // Watch the content directory tree
  function watchDir(dir) {
    if (!fs.existsSync(dir)) return;
    fs.watch(dir, { recursive: true }, (_, filename) => {
      if (filename && filename.endsWith('.md')) trigger(filename);
    });
  }

  watchDir(CONTENT);
  console.log('  Press Ctrl+C to stop.\n');
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

if (MODE === 'build') runBuild();
else if (MODE === 'audit') runAudit();
else if (MODE === 'watch') runWatch();
