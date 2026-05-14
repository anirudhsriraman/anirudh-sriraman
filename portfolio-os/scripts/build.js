#!/usr/bin/env node
/**
 * build.js — reads /content/ Markdown files and produces /output/index.html
 *
 * No external dependencies. Uses only Node.js built-ins.
 * Run: node scripts/build.js
 */

const fs = require('fs');
const path = require('path');

// ─── Paths ────────────────────────────────────────────────────────────────────
const ROOT = path.resolve(__dirname, '..');
const CONTENT = path.join(ROOT, 'content');
const SRC_DATA = path.join(ROOT, 'src', 'data');
const OUTPUT_DIR = path.join(ROOT, 'output');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'index.html');

// ─── Frontmatter parser ───────────────────────────────────────────────────────
function parseFrontmatter(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };

  const meta = {};
  match[1].split('\n').forEach(line => {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) return;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();

    // Parse arrays: ["a", "b"] or [a, b]
    if (value.startsWith('[')) {
      try {
        value = JSON.parse(value.replace(/'/g, '"'));
      } catch {
        value = value.replace(/[\[\]]/g, '').split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
      }
    } else {
      // Strip surrounding quotes
      value = value.replace(/^["']|["']$/g, '');
    }
    meta[key] = value;
  });

  return { meta, body: match[2].trim() };
}

// ─── Minimal Markdown → HTML converter ───────────────────────────────────────
function mdToHtml(md) {
  let html = md;

  // Escape HTML entities in content (basic)
  // We do this carefully — only in text nodes, not tags we generate
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Tables
  html = html.replace(/\|(.+)\|\n\|[-| :]+\|\n((?:\|.+\|\n?)+)/gm, (_, header, rows) => {
    const ths = header.split('|').filter(s => s.trim()).map(s => `<th>${s.trim()}</th>`).join('');
    const trs = rows.trim().split('\n').map(row => {
      const tds = row.split('|').filter(s => s.trim()).map(s => `<td>${s.trim()}</td>`).join('');
      return `<tr>${tds}</tr>`;
    }).join('\n');
    return `<table>\n<thead><tr>${ths}</tr></thead>\n<tbody>${trs}</tbody>\n</table>\n`;
  });

  // Blockquotes
  html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');

  // Headings
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Bold+italic, bold, italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // HR
  html = html.replace(/^---$/gm, '<hr>');

  // Unordered lists
  html = html.replace(/((?:^- .+\n?)+)/gm, match => {
    const items = match.trim().split('\n').map(l => `<li>${l.replace(/^- /, '')}</li>`).join('\n');
    return `<ul>\n${items}\n</ul>\n`;
  });

  // Paragraphs — wrap lines that aren't already tags
  const lines = html.split('\n');
  const out = [];
  let inBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { inBlock = false; out.push(''); continue; }

    const isTag = /^<(h[1-6]|ul|ol|li|table|thead|tbody|tr|th|td|blockquote|hr|\/)/i.test(trimmed);
    if (isTag) { inBlock = false; out.push(line); continue; }

    if (!inBlock) {
      out.push(`<p>${trimmed}`);
      inBlock = true;
    } else {
      out.push(trimmed);
    }
  }

  html = out.join('\n');
  // Close open <p> tags before block elements
  html = html.replace(/<p>([\s\S]*?)(?=<(?:h[1-6]|ul|ol|table|blockquote|hr))/g, '<p>$1</p>\n');
  // Close trailing open <p>
  html = html.replace(/<p>([^<][\s\S]*?)$/g, '<p>$1</p>');

  return html;
}

// ─── Read all files in a directory ───────────────────────────────────────────
function readDir(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const raw = fs.readFileSync(path.join(dir, f), 'utf8');
      return { file: f, ...parseFrontmatter(raw) };
    });
}

// ─── Section builders ─────────────────────────────────────────────────────────

function buildHero(profile, statusData) {
  const { meta } = profile;
  // Use structured status.json if available, fall back to status.md meta
  const availability = statusData.availability || meta.availability || 'open';
  const badge        = statusData.badge  !== undefined ? statusData.badge  : (status.meta['status-label'] || 'Available');
  const primary      = statusData.primary  || `${status.meta['status-label'] || 'Available'} · ${status.meta['role-focus'] || ''}`;
  const secondary    = statusData.secondary || null;
  const urgency      = statusData.urgency || false;

  const badgeHtml = badge
    ? `<div class="availability-badge ${urgency ? 'open' : ''}">${badge}</div>`
    : '';

  const ctaHtml = `
        <div class="hero-cta">
          <p class="hero-cta-primary">${primary}</p>
          ${secondary ? `<p class="hero-cta-secondary">${secondary}</p>` : ''}
        </div>`;

  return `
    <section id="hero" class="hero">
      <div class="container">
        ${badgeHtml}
        <h1 class="hero-name">${meta.name}</h1>
        <p class="hero-title">${meta.title}</p>
        <p class="hero-tagline">"${meta.tagline}"</p>
        <div class="hero-contact">
          <a href="mailto:${meta.email}">${meta.email}</a>
          <a href="https://wa.me/${meta.whatsapp}">WhatsApp +${meta.whatsapp}</a>
          <a href="${meta.linkedin}" target="_blank" rel="noopener">LinkedIn</a>
        </div>
        ${ctaHtml}
        <div class="hero-body">${mdToHtml(profile.body)}</div>
      </div>
    </section>`;
}

function buildCaseStudies(caseStudies) {
  const sorted = [...caseStudies].sort((a, b) => (Number(a.meta.priority) || 99) - (Number(b.meta.priority) || 99));

  const cards = sorted.map(cs => {
    const metrics = Array.isArray(cs.meta.metrics)
      ? cs.meta.metrics.map(m => `<span class="metric">${m}</span>`).join('')
      : '';
    const tags = Array.isArray(cs.meta.tags)
      ? cs.meta.tags.map(t => `<span class="tag">${t}</span>`).join('')
      : '';
    const audience = Array.isArray(cs.meta.audience)
      ? cs.meta.audience.map(a => `<span class="audience audience-${a}">${a}</span>`).join('')
      : '';
    return `
      <article class="case-study-card" data-slug="${cs.meta.slug}" data-priority="${cs.meta.priority}">
        <div class="cs-meta">
          <div class="cs-audience">${audience}</div>
          <div class="cs-metrics">${metrics}</div>
        </div>
        <h3 class="cs-title">${cs.meta.title}</h3>
        <div class="cs-body">${mdToHtml(cs.body)}</div>
        <div class="cs-tags">${tags}</div>
      </article>`;
  }).join('\n');

  return `
    <section id="work" class="work">
      <div class="container">
        <h2 class="section-title">Work</h2>
        <div class="case-studies-grid">
          ${cards}
        </div>
      </div>
    </section>`;
}

function buildFrameworks(frameworks) {
  const cards = frameworks.map(fw => `
    <article class="framework-card" data-slug="${fw.meta.slug || ''}">
      <h3 class="fw-title">${fw.meta.title}</h3>
      <div class="fw-body">${mdToHtml(fw.body)}</div>
    </article>`).join('\n');

  return `
    <section id="thinking" class="thinking">
      <div class="container">
        <h2 class="section-title">Frameworks & Thinking</h2>
        <div class="frameworks-grid">
          ${cards}
        </div>
      </div>
    </section>`;
}

function buildTestimonials(testimonials) {
  const cards = testimonials.map(t => `
    <figure class="testimonial-card">
      <blockquote class="testimonial-quote">${t.body.replace(/^"|"$/g, '').trim()}</blockquote>
      <figcaption>
        <span class="testimonial-initials">${t.meta.initials || ''}</span>
        <div class="testimonial-attribution">
          <strong>${t.meta.name}</strong>
          <span>${t.meta.title}</span>
          ${t.meta.relationship ? `<span class="testimonial-relationship">${t.meta.relationship}${t.meta.tenure ? ' · ' + t.meta.tenure : ''}</span>` : ''}
        </div>
      </figcaption>
    </figure>`).join('\n');

  return `
    <section id="people" class="people">
      <div class="container">
        <h2 class="section-title">From the Team</h2>
        <div class="testimonials-grid">
          ${cards}
        </div>
      </div>
    </section>`;
}

function buildNav() {
  return `
    <nav class="nav">
      <div class="container nav-inner">
        <span class="nav-brand">AS</span>
        <ul class="nav-links">
          <li><a href="#hero">Home</a></li>
          <li><a href="#work">Work</a></li>
          <li><a href="#thinking">Thinking</a></li>
          <li><a href="#people">People</a></li>
          <li><a href="#contact">Contact</a></li>
        </ul>
      </div>
    </nav>`;
}

function buildFooter(profile) {
  const { meta } = profile;
  return `
    <footer id="contact" class="footer">
      <div class="container">
        <h2 class="section-title">Contact</h2>
        <p>${meta.name} · ${meta.location}</p>
        <div class="footer-links">
          <a href="mailto:${meta.email}">${meta.email}</a>
          <a href="https://wa.me/${meta.whatsapp}">WhatsApp +${meta.whatsapp}</a>
          <a href="${meta.linkedin}" target="_blank" rel="noopener">LinkedIn</a>
        </div>
        <p class="footer-updated">Last updated: ${meta.updated}</p>
      </div>
    </footer>`;
}

// ─── CSS ──────────────────────────────────────────────────────────────────────
const CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg: #0a0a0a;
    --bg-surface: #111111;
    --bg-card: #161616;
    --border: #2a2a2a;
    --text: #e8e8e8;
    --text-muted: #888;
    --accent: #c8a96e;
    --accent-dim: #8a6f3e;
    --green: #4ade80;
    --font: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
  }

  html { scroll-behavior: smooth; font-size: 16px; }

  body {
    background: var(--bg);
    color: var(--text);
    font-family: var(--font);
    line-height: 1.6;
  }

  .container { max-width: 1100px; margin: 0 auto; padding: 0 2rem; }

  /* Nav */
  .nav {
    position: sticky; top: 0; z-index: 100;
    background: rgba(10,10,10,0.9);
    backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--border);
    padding: 1rem 0;
  }
  .nav-inner { display: flex; justify-content: space-between; align-items: center; }
  .nav-brand { font-family: var(--font-mono); font-size: 1.1rem; color: var(--accent); font-weight: 700; }
  .nav-links { list-style: none; display: flex; gap: 2rem; }
  .nav-links a { color: var(--text-muted); text-decoration: none; font-size: 0.9rem; transition: color 0.2s; }
  .nav-links a:hover { color: var(--text); }

  /* Hero */
  .hero { padding: 6rem 0 4rem; }
  .availability-badge {
    display: inline-block; padding: 0.3rem 0.9rem;
    border: 1px solid var(--border); border-radius: 999px;
    font-size: 0.8rem; color: var(--text-muted); margin-bottom: 2rem;
  }
  .availability-badge.open { border-color: var(--green); color: var(--green); }
  .hero-name { font-size: clamp(2.5rem, 6vw, 4rem); font-weight: 700; letter-spacing: -0.02em; margin-bottom: 0.5rem; }
  .hero-title { font-size: 1.1rem; color: var(--text-muted); margin-bottom: 1.5rem; }
  .hero-tagline { font-size: clamp(1.1rem, 2.5vw, 1.4rem); color: var(--accent); font-style: italic; margin-bottom: 2rem; max-width: 700px; }
  .hero-cta { margin-bottom: 2rem; }
  .hero-cta-primary { font-size: 1rem; color: var(--text); font-weight: 500; margin-bottom: 0.4rem; }
  .hero-cta-secondary { font-size: 0.9rem; color: var(--accent); }
  .hero-contact { display: flex; gap: 1.5rem; flex-wrap: wrap; margin-bottom: 2.5rem; }
  .hero-contact a { color: var(--text-muted); text-decoration: none; font-size: 0.9rem; border-bottom: 1px solid var(--border); padding-bottom: 2px; transition: color 0.2s, border-color 0.2s; }
  .hero-contact a:hover { color: var(--accent); border-color: var(--accent); }
  .hero-body { max-width: 720px; color: var(--text-muted); }
  .hero-body p { margin-bottom: 1rem; }
  .hero-body strong { color: var(--text); }

  /* Section titles */
  .section-title { font-size: 1.8rem; font-weight: 700; margin-bottom: 3rem; letter-spacing: -0.01em; }
  section { padding: 5rem 0; border-top: 1px solid var(--border); }

  /* Case Studies */
  .case-studies-grid { display: grid; gap: 2rem; }
  .case-study-card {
    background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px;
    padding: 2rem; transition: border-color 0.2s;
  }
  .case-study-card:hover { border-color: var(--accent-dim); }
  .cs-meta { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.5rem; }
  .cs-audience { display: flex; gap: 0.4rem; }
  .audience { font-size: 0.7rem; padding: 0.2rem 0.6rem; border-radius: 999px; border: 1px solid var(--border); color: var(--text-muted); font-family: var(--font-mono); }
  .audience-cpo { border-color: #6366f1; color: #818cf8; }
  .audience-dx { border-color: #0ea5e9; color: #38bdf8; }
  .audience-recruiter { border-color: #10b981; color: #34d399; }
  .cs-metrics { display: flex; gap: 0.5rem; flex-wrap: wrap; }
  .metric { font-size: 0.8rem; font-family: var(--font-mono); color: var(--accent); background: rgba(200,169,110,0.08); padding: 0.2rem 0.6rem; border-radius: 4px; }
  .cs-title { font-size: 1.25rem; font-weight: 600; margin-bottom: 1rem; }
  .cs-body { color: var(--text-muted); font-size: 0.95rem; }
  .cs-body p { margin-bottom: 0.75rem; }
  .cs-body h2, .cs-body h3 { color: var(--text); margin: 1.2rem 0 0.5rem; font-size: 1rem; }
  .cs-body strong { color: var(--text); }
  .cs-body ul { padding-left: 1.5rem; margin-bottom: 0.75rem; }
  .cs-tags { display: flex; gap: 0.4rem; flex-wrap: wrap; margin-top: 1.2rem; }
  .tag { font-size: 0.72rem; color: var(--text-muted); background: var(--bg-surface); border: 1px solid var(--border); padding: 0.15rem 0.5rem; border-radius: 4px; }

  /* Frameworks */
  .frameworks-grid { display: grid; gap: 2rem; }
  .framework-card {
    background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px;
    padding: 2rem;
  }
  .fw-title { font-size: 1.2rem; font-weight: 600; margin-bottom: 1.2rem; color: var(--accent); }
  .fw-body { color: var(--text-muted); font-size: 0.93rem; }
  .fw-body p { margin-bottom: 0.75rem; }
  .fw-body h2, .fw-body h3 { color: var(--text); margin: 1.5rem 0 0.5rem; }
  .fw-body h2 { font-size: 1.05rem; }
  .fw-body h3 { font-size: 0.95rem; }
  .fw-body strong { color: var(--text); }
  .fw-body ul { padding-left: 1.5rem; margin-bottom: 0.75rem; }
  .fw-body blockquote { border-left: 3px solid var(--accent); padding-left: 1rem; color: var(--accent); font-style: italic; margin: 1rem 0; }
  .fw-body table { width: 100%; border-collapse: collapse; margin: 1rem 0; font-size: 0.88rem; }
  .fw-body th { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--border); color: var(--text); }
  .fw-body td { padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--border); color: var(--text-muted); }
  .fw-body hr { border: none; border-top: 1px solid var(--border); margin: 2rem 0; }

  /* Testimonials */
  .testimonials-grid { display: grid; gap: 1.5rem; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
  .testimonial-card {
    background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px;
    padding: 1.75rem; display: flex; flex-direction: column; gap: 1.2rem;
  }
  .testimonial-quote { font-size: 0.95rem; color: var(--text); line-height: 1.7; font-style: italic; }
  .testimonial-card figcaption { display: flex; align-items: center; gap: 0.9rem; }
  .testimonial-initials {
    width: 40px; height: 40px; border-radius: 50%; background: var(--bg-surface);
    border: 1px solid var(--border); display: flex; align-items: center; justify-content: center;
    font-family: var(--font-mono); font-size: 0.8rem; color: var(--accent); flex-shrink: 0;
  }
  .testimonial-attribution { display: flex; flex-direction: column; gap: 0.1rem; }
  .testimonial-attribution strong { font-size: 0.9rem; }
  .testimonial-attribution span { font-size: 0.8rem; color: var(--text-muted); }
  .testimonial-relationship { font-size: 0.75rem !important; }

  /* Footer */
  .footer { padding: 4rem 0; }
  .footer .section-title { margin-bottom: 1rem; }
  .footer p { color: var(--text-muted); margin-bottom: 1rem; }
  .footer-links { display: flex; gap: 1.5rem; flex-wrap: wrap; margin-bottom: 1rem; }
  .footer-links a { color: var(--text-muted); text-decoration: none; font-size: 0.9rem; transition: color 0.2s; }
  .footer-links a:hover { color: var(--accent); }
  .footer-updated { font-size: 0.78rem; color: var(--border); }

  code { font-family: var(--font-mono); font-size: 0.88em; background: var(--bg-surface); padding: 0.1em 0.4em; border-radius: 3px; }

  @media (max-width: 640px) {
    .nav-links { gap: 1rem; }
    .cs-meta { flex-direction: column; }
    .hero-contact { flex-direction: column; gap: 0.75rem; }
  }
`;

// ─── Main build ───────────────────────────────────────────────────────────────
function build() {
  console.log('Building portfolio-os...\n');

  const profileRaw = fs.readFileSync(path.join(CONTENT, 'profile.md'), 'utf8');
  const profile = parseFrontmatter(profileRaw);

  const statusRaw = fs.readFileSync(path.join(CONTENT, 'status.md'), 'utf8');
  const status = parseFrontmatter(statusRaw);

  // Load generated data files if available
  const statusJsonPath  = path.join(SRC_DATA, 'status.json');
  const routingJsonPath = path.join(SRC_DATA, 'routing.json');

  const statusData  = fs.existsSync(statusJsonPath)  ? JSON.parse(fs.readFileSync(statusJsonPath,  'utf8')) : {};
  const routingData = fs.existsSync(routingJsonPath) ? JSON.parse(fs.readFileSync(routingJsonPath, 'utf8')) : {};

  const caseStudies = readDir(path.join(CONTENT, 'case-studies'));
  const frameworks = readDir(path.join(CONTENT, 'frameworks'));
  const testimonials = readDir(path.join(CONTENT, 'testimonials'));

  console.log(`  profile.md          ✓`);
  console.log(`  status.md           ✓`);
  console.log(`  src/data/status.json  ${fs.existsSync(statusJsonPath)  ? '✓' : '(not found — using status.md fallback)'}`);
  console.log(`  src/data/routing.json ${fs.existsSync(routingJsonPath) ? '✓' : '(not found — no routing data)'}`);
  console.log(`  case-studies        ${caseStudies.length} files`);
  console.log(`  frameworks          ${frameworks.length} files`);
  console.log(`  testimonials        ${testimonials.length} files`);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${profile.meta.name} - ${profile.meta.title}</title>
  <meta name="description" content="${profile.meta.tagline}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
  <style>${CSS}</style>
</head>
<body>
  ${buildNav()}
  <main>
    ${buildHero(profile, statusData)}
    ${buildCaseStudies(caseStudies)}
    ${buildFrameworks(frameworks)}
    ${buildTestimonials(testimonials)}
  </main>
  ${buildFooter(profile)}
  <script id="portfolio-status" type="application/json">
${JSON.stringify(statusData, null, 2)}
  </script>
  <script id="portfolio-routing" type="application/json">
${JSON.stringify(routingData, null, 2)}
  </script>
</body>
</html>`;

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, html, 'utf8');

  const sizeKb = (fs.statSync(OUTPUT_FILE).size / 1024).toFixed(1);
  console.log(`\nOutput: output/index.html (${sizeKb} KB)`);
  console.log('Build complete.\n');

  // Summary
  return {
    caseStudies: caseStudies.map(c => c.meta.slug),
    frameworks: frameworks.map(f => f.meta.slug),
    testimonials: testimonials.map(t => t.meta.name),
    sizeKb,
  };
}

build();
