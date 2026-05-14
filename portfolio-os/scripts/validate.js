#!/usr/bin/env node
/**
 * validate.js — checks that output/index.html matches content source
 * Run: node scripts/validate.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CONTENT = path.join(ROOT, 'content');
const OUTPUT_FILE = path.join(ROOT, 'output', 'index.html');

let errors = 0;
let warnings = 0;

function fail(msg) { console.error(`  ✗ ${msg}`); errors++; }
function warn(msg) { console.warn(`  ⚠ ${msg}`); warnings++; }
function ok(msg) { console.log(`  ✓ ${msg}`); }

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

console.log('\nValidating output/index.html against /content/...\n');

if (!fs.existsSync(OUTPUT_FILE)) {
  fail('output/index.html does not exist. Run: node scripts/build.js');
  process.exit(1);
}

const html = fs.readFileSync(OUTPUT_FILE, 'utf8');

// Check sections
['id="hero"', 'id="work"', 'id="thinking"', 'id="people"', 'id="contact"'].forEach(id => {
  if (html.includes(id)) ok(`Section ${id} present`);
  else fail(`Missing section: ${id}`);
});

// Check all case studies appear by slug
const csDir = path.join(CONTENT, 'case-studies');
fs.readdirSync(csDir).filter(f => f.endsWith('.md')).forEach(f => {
  const meta = parseFrontmatter(fs.readFileSync(path.join(csDir, f), 'utf8'));
  if (meta.slug && html.includes(meta.slug)) ok(`Case study slug present: ${meta.slug}`);
  else if (meta.title && html.includes(meta.title)) ok(`Case study title present: ${meta.title}`);
  else fail(`Case study missing in output: ${f}`);
});

// Check testimonials by name
const tDir = path.join(CONTENT, 'testimonials');
fs.readdirSync(tDir).filter(f => f.endsWith('.md')).forEach(f => {
  const meta = parseFrontmatter(fs.readFileSync(path.join(tDir, f), 'utf8'));
  if (meta.name && html.includes(meta.name)) ok(`Testimonial present: ${meta.name}`);
  else fail(`Testimonial missing: ${f}`);
});

// Check frameworks
const fwDir = path.join(CONTENT, 'frameworks');
fs.readdirSync(fwDir).filter(f => f.endsWith('.md')).forEach(f => {
  const meta = parseFrontmatter(fs.readFileSync(path.join(fwDir, f), 'utf8'));
  if (meta.title && html.includes(meta.title)) ok(`Framework present: ${meta.title}`);
  else fail(`Framework missing: ${f}`);
});

// Check key profile fields
const profile = parseFrontmatter(fs.readFileSync(path.join(CONTENT, 'profile.md'), 'utf8'));
['name', 'email', 'linkedin'].forEach(field => {
  if (profile[field] && html.includes(profile[field])) ok(`Profile field present: ${field}`);
  else warn(`Profile field possibly missing: ${field}`);
});

// Check for placeholder text
['TODO', 'PLACEHOLDER', 'lorem ipsum', 'undefined', 'null'].forEach(bad => {
  if (html.toLowerCase().includes(bad.toLowerCase())) warn(`Possible placeholder found: "${bad}"`);
});

// File size check
const sizeKb = (fs.statSync(OUTPUT_FILE).size / 1024).toFixed(1);
ok(`Output size: ${sizeKb} KB`);

console.log(`\n${'─'.repeat(40)}`);
if (errors === 0 && warnings === 0) {
  console.log('All checks passed.\n');
} else {
  console.log(`${errors} error(s), ${warnings} warning(s)\n`);
  if (errors > 0) process.exit(1);
}
