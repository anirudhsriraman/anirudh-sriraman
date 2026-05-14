#!/usr/bin/env node
/**
 * watch.js — watches /content/ and rebuilds output/index.html on any change
 * Run: node scripts/watch.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CONTENT = path.resolve(__dirname, '../content');
const BUILD = path.resolve(__dirname, 'build.js');

console.log(`Watching ${CONTENT} for changes...\n`);

let debounce = null;

function rebuild() {
  try {
    execSync(`node "${BUILD}"`, { stdio: 'inherit' });
  } catch (e) {
    console.error('Build failed:', e.message);
  }
}

function watch(dir) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      watch(full);
      fs.watch(full, () => {
        clearTimeout(debounce);
        debounce = setTimeout(rebuild, 150);
      });
    }
  });

  fs.watch(dir, (event, filename) => {
    if (!filename || !filename.endsWith('.md')) return;
    console.log(`Changed: ${filename}`);
    clearTimeout(debounce);
    debounce = setTimeout(rebuild, 150);
  });
}

rebuild();
watch(CONTENT);
