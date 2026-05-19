#!/usr/bin/env node
/**
 * build.js -- reads /content/ Markdown files and produces /output/index.html
 *
 * Bauhaus design system. No external dependencies. Node.js built-ins only.
 * Run: node scripts/build.js
 */

const fs   = require('fs');
const path = require('path');

// ---- Paths ------------------------------------------------------------------

const ROOT        = path.resolve(__dirname, '..');
const CONTENT     = path.join(ROOT, 'content');
const SRC_DATA    = path.join(ROOT, 'src', 'data');
const OUTPUT_DIR  = path.join(ROOT, 'output');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'index.html');

// ---- Frontmatter parser -----------------------------------------------------

function parseFrontmatter(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };

  const meta = {};
  match[1].split('\n').forEach(line => {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) return;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    if (value.startsWith('[')) {
      try { value = JSON.parse(value.replace(/'/g, '"')); }
      catch { value = value.replace(/[\[\]]/g, '').split(',').map(s => s.trim().replace(/^["']|["']$/g, '')); }
    } else {
      value = value.replace(/^["']|["']$/g, '');
    }
    meta[key] = value;
  });

  return { meta, body: match[2].trim() };
}

// ---- Minimal Markdown to HTML -----------------------------------------------

function mdToHtml(md) {
  let html = md;

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

  // Paragraphs
  const lines = html.split('\n');
  const out = [];
  let inBlock = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { inBlock = false; out.push(''); continue; }
    const isTag = /^<(h[1-6]|ul|ol|li|table|thead|tbody|tr|th|td|blockquote|hr|\/)/i.test(trimmed);
    if (isTag) { inBlock = false; out.push(line); continue; }
    if (!inBlock) { out.push(`<p>${trimmed}`); inBlock = true; }
    else { out.push(trimmed); }
  }
  html = out.join('\n');
  html = html.replace(/<p>([\s\S]*?)(?=<(?:h[1-6]|ul|ol|table|blockquote|hr))/g, '<p>$1</p>\n');
  html = html.replace(/<p>([^<][\s\S]*?)$/g, '<p>$1</p>');

  return html;
}

// ---- Read directory of .md files --------------------------------------------

function readDir(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const raw = fs.readFileSync(path.join(dir, f), 'utf8');
      return { file: f, ...parseFrontmatter(raw) };
    });
}

// ---- Parse case study body into sections ------------------------------------

function parseCsBody(body) {
  const lines   = body.split('\n');
  const sections = {};
  let current   = 'framing';
  let buf       = [];

  const SECTION_MAP = {
    framing:  /^##\s+(Framing)\b/i,
    context:  /^##\s+(Context|Situation|Challenge|Problem|Background)\b/i,
    decision: /^##\s+(Decision|Solution|Approach)\b/i,
    action:   /^##\s+(Action|Response|Fix)\b/i,
    outcome:  /^##\s+(Outcome|Result|Impact|Delivery)\b/i,
  };

  for (const line of lines) {
    let matched = false;
    for (const [key, re] of Object.entries(SECTION_MAP)) {
      if (re.test(line)) {
        sections[current] = buf.join('\n').trim();
        current = key;
        buf = [];
        matched = true;
        break;
      }
    }
    if (!matched) buf.push(line);
  }
  sections[current] = buf.join('\n').trim();

  return sections;
}

// ---- SVG bar chart helper ---------------------------------------------------

function buildArrChart() {
  const data = [
    { year: 'Year 1', val: 0.8, label: '$0.8M' },
    { year: 'Year 2', val: 1.5, label: '$1.5M' },
    { year: 'Year 3', val: 2.8, label: '$2.8M' },
    { year: 'Year 4', val: 4.2, label: '$4.2M' },
    { year: 'Year 5', val: 6.0, label: '$6M ARR' },
  ];
  const maxVal   = 6;
  const svgH     = 180;
  const barW     = 40;
  const gap      = 16;
  const padL     = 36;
  const padB     = 28;
  const chartH   = svgH - padB;
  const totalW   = padL + data.length * (barW + gap) + gap;

  const bars = data.map((d, i) => {
    const h   = Math.round((d.val / maxVal) * chartH);
    const x   = padL + gap + i * (barW + gap);
    const y   = chartH - h;
    const isFinal = i === data.length - 1;
    return `
      <rect x="${x}" y="${y}" width="${barW}" height="${h}" fill="var(--accent)" />
      <text x="${x + barW / 2}" y="${y - 4}" text-anchor="middle" font-size="9" font-weight="${isFinal ? '700' : '400'}" fill="var(--text)">${d.label}</text>
      <text x="${x + barW / 2}" y="${svgH - 6}" text-anchor="middle" font-size="9" fill="var(--text-muted)">${d.year}</text>`;
  }).join('');

  // Y-axis labels
  const yLabels = ['$0', '$2M', '$4M', '$6M'].map((l, i) => {
    const y = chartH - Math.round((i * 2 / maxVal) * chartH);
    return `<text x="${padL - 4}" y="${y + 3}" text-anchor="end" font-size="8" fill="var(--text-muted)">${l}</text>
      <line x1="${padL}" y1="${y}" x2="${totalW}" y2="${y}" stroke="var(--text-muted)" stroke-width="0.5" stroke-dasharray="2,3" opacity="0.4"/>`;
  }).join('');

  return `
    <svg viewBox="0 0 ${totalW} ${svgH}" xmlns="http://www.w3.org/2000/svg" style="width:100%;overflow:visible">
      <!-- axes -->
      <line x1="${padL}" y1="0" x2="${padL}" y2="${chartH}" stroke="var(--border)" stroke-width="1.5"/>
      <line x1="${padL}" y1="${chartH}" x2="${totalW}" y2="${chartH}" stroke="var(--border)" stroke-width="1.5"/>
      ${yLabels}
      ${bars}
    </svg>`;
}

function buildRetentionChart() {
  return `
    <div class="retention-chart">
      <div class="retention-row">
        <div class="retention-label-row">
          <span class="retention-name">Before</span>
          <span class="retention-pct" style="color:var(--text-muted)">70%</span>
        </div>
        <div class="retention-bar-track">
          <div class="retention-bar-fill" style="width:70%;background:var(--text-muted)"></div>
        </div>
      </div>
      <div class="retention-row">
        <div class="retention-label-row">
          <span class="retention-name">After</span>
          <span class="retention-pct" style="color:var(--accent)">96%</span>
        </div>
        <div class="retention-bar-track">
          <div class="retention-bar-fill" style="width:96%;background:var(--accent)">
            <span class="retention-annotation">+26pts</span>
          </div>
        </div>
      </div>
    </div>`;
}

// ---- Visual 1: Growth Chart (Impact section) --------------------------------

function buildVisual1() {
  return `
    <div class="charts-grid">
      <div class="card chart-card">
        <div class="chart-title">ARR Growth</div>
        ${buildArrChart()}
      </div>
      <div class="card chart-card">
        <div class="chart-title">Customer Retention</div>
        ${buildRetentionChart()}
      </div>
    </div>
    <p class="chart-source">Dropthought · Bahwan CyberTek · 2016-2026</p>`;
}

// ---- Visual 2: NLP Accuracy Progression (On AI section) --------------------

function buildVisual2() {
  const stages = [
    {
      name: 'Baseline',
      pct: 52,
      opacity: 1,
      color: 'var(--text-muted)',
      notes: ['Off-the-shelf model', 'Too low to ship to enterprise clients'],
    },
    {
      name: 'HumInt Pipeline Built',
      pct: 65,
      opacity: 0.6,
      color: 'var(--accent)',
      notes: ['Dual-annotator consensus', '5.4M labeled data points', '90% inter-annotator agreement'],
    },
    {
      name: 'Production Ready',
      pct: 78,
      opacity: 1,
      color: 'var(--accent)',
      notes: ['Shipped to GCC enterprise', 'Arabic NLP · Regulated markets'],
    },
  ];

  const rows = stages.map(s => {
    const fillColor = s.opacity < 1
      ? `rgba(11,110,110,0.6)`
      : s.color === 'var(--accent)' ? '#0B6E6E' : '#6B6B6B';
    const notes = s.notes.map(n => `<span class="nlp-note">${n}</span>`).join('');
    return `
      <div class="nlp-stage">
        <div class="nlp-stage-header">
          <span class="nlp-stage-name">${s.name}</span>
          <span class="nlp-stage-pct">${s.pct}%</span>
        </div>
        <div class="nlp-bar-track">
          <div class="nlp-bar-fill" style="width:${s.pct}%;background:${fillColor}"></div>
        </div>
        <div class="nlp-stage-notes">${notes}</div>
      </div>`;
  }).join('');

  return `
    <div class="card" style="padding:2rem">
      <div class="nlp-chart-title">From 52% to 78% -- Making Arabic NLP Trustworthy Enough to Ship</div>
      <div class="nlp-stages">${rows}</div>
      <p class="nlp-governance">Governance layer: accuracy threshold &gt;85% set before GA · hallucination rate &lt;5% · human review on all edge cases</p>
    </div>`;
}

// ---- Visual 3: CX Maturity Tier Ladder (Frameworks section) ----------------

function buildVisual3() {
  const tiers = [
    {
      letter: 'A',
      name: 'Feedback + Analytics',
      desc: 'Collect feedback, run NLP, view dashboards',
      tag: 'Entry point',
      inverse: false,
    },
    {
      letter: 'B',
      name: 'Workflow Automation',
      desc: 'Feedback triggers automated recovery actions',
      tag: 'Requires defined processes',
      inverse: false,
    },
    {
      letter: 'C',
      name: 'Natural Language Q&amp;A',
      desc: 'Analysts query feedback corpus in plain English',
      tag: 'Requires data literacy',
      inverse: false,
    },
    {
      letter: 'D',
      name: 'Agentic AI',
      desc: 'AI acts autonomously -- routes, responds, escalates without human initiation',
      tag: 'Requires executive governance',
      inverse: true,
    },
  ];

  const rows = tiers.map(t => `
    <div class="maturity-tier${t.inverse ? ' maturity-tier-d' : ''}">
      <div class="maturity-tier-letter">${t.letter}</div>
      <div class="maturity-tier-content">
        <div class="maturity-tier-name">${t.name}</div>
        <div class="maturity-tier-desc">${t.desc}</div>
      </div>
      <div class="maturity-tier-tag">${t.tag}</div>
    </div>`).join('');

  return `
    <div class="card">
      <div style="padding:2rem 2rem 0">
        <div class="maturity-title">AI-CX Client Readiness Diagnostic</div>
        <div class="maturity-subtitle">5-dimension framework -- built from 40+ enterprise deployments across GCC</div>
      </div>
      ${rows}
      <div class="maturity-note">Critical rule: score what the client demonstrates, not what they claim.</div>
    </div>`;
}

// ---- Section header helper --------------------------------------------------

function buildSectionHeader(num, title, subtitle) {
  const sub = subtitle
    ? `<p class="section-subtitle">${subtitle}</p>`
    : '';
  return `
    <div class="section-header">
      <div class="section-eyebrow">
        <span class="section-num">${num}</span>
        <div class="section-rule"></div>
      </div>
      <h2 class="section-title">${title}</h2>
      ${sub}
    </div>`;
}

// ---- Nav --------------------------------------------------------------------

function buildNav() {
  return `
    <nav class="nav" role="navigation" aria-label="Main navigation">
      <div class="nav-inner">
        <div class="nav-left">
          <strong>AS</strong>
          <span class="nav-divider">|</span>
          <span class="nav-role">Sr. Director of Product</span>
        </div>
        <ul class="nav-center">
          <li><a href="#work">Impact</a></li>
          <li><a href="#achievements">Key Achievements</a></li>
          <li><a href="#thinking">On AI</a></li>
          <li><a href="#experience">Experience</a></li>
          <li><a href="#people">From the Team</a></li>
          <li><a href="#contact">Contact</a></li>
        </ul>
        <div class="nav-right">
          <a class="nav-cta" href="#contact">Let's Talk</a>
          <button class="nav-hamburger" aria-label="Open menu" onclick="this.nextElementSibling.classList.toggle('open')">&#9776;</button>
          <ul class="nav-mobile-menu">
            <li><a href="#work" onclick="this.closest('.nav-mobile-menu').classList.remove('open')">Impact</a></li>
            <li><a href="#achievements" onclick="this.closest('.nav-mobile-menu').classList.remove('open')">Key Achievements</a></li>
            <li><a href="#thinking" onclick="this.closest('.nav-mobile-menu').classList.remove('open')">On AI</a></li>
            <li><a href="#experience" onclick="this.closest('.nav-mobile-menu').classList.remove('open')">Experience</a></li>
            <li><a href="#people" onclick="this.closest('.nav-mobile-menu').classList.remove('open')">From the Team</a></li>
            <li><a href="#contact" onclick="this.closest('.nav-mobile-menu').classList.remove('open')">Contact</a></li>
          </ul>
        </div>
      </div>
    </nav>`;
}

// ---- Hero -------------------------------------------------------------------

function buildHero(profile, statusData) {
  const { meta } = profile;
  const badgeLabel = statusData.primary || 'Open to Sr. Director of Product Roles';

  return `
    <section id="hero" class="hero">
      <div class="container">
        <div class="hero-grid">
          <div class="hero-left">
            <div class="availability-badge">
              <span class="badge-dot">&#9679;</span>
              ${badgeLabel}
            </div>
            <div class="metric-pills">
              <div class="metric-pill"><span class="pill-value">14yr</span><span class="pill-label">Experience</span></div>
              <div class="metric-pill"><span class="pill-value">$6M</span><span class="pill-label">ARR Built</span></div>
              <div class="metric-pill"><span class="pill-value">96%</span><span class="pill-label">Retention</span></div>
            </div>
            <h1 class="hero-name">Anirudh Sriraman</h1>
            <p class="hero-title">Sr. Director of Product</p>
            <p class="hero-tagline">14 years building AI-CX platforms that scale enterprise revenue across GCC regulated markets.</p>
            <div class="hero-ctas">
              <a href="#work" class="cta-primary">See My Impact &#8594;</a>
              <a href="#contact" class="cta-secondary">&#9993; Get in Touch</a>
            </div>
            <hr class="hero-divider">
            <div class="hero-metrics-bar">
              <div class="metric-item">
                <span class="metric-number">14+</span>
                <span class="metric-label">Years Experience</span>
              </div>
              <div class="metric-item">
                <span class="metric-number">$6M</span>
                <span class="metric-label">ARR from Zero</span>
              </div>
              <div class="metric-item">
                <span class="metric-number">96%</span>
                <span class="metric-label">Customer Retention</span>
              </div>
              <div class="metric-item">
                <span class="metric-number">35%</span>
                <span class="metric-label">RFP Win Rate</span>
              </div>
            </div>
          </div>
          <div class="hero-right">
            <div class="portrait-outer">
              <div class="portrait-frame"></div>
              <div class="portrait-box">
                <img src="assets/images/headshot.png" alt="Anirudh Sriraman" style="max-width:100%">
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
    <div class="ticker-row">
      <div class="ticker-inner">
        <span class="ticker-label">Clients</span>
        <div class="ticker-names">
          <span class="ticker-name">MoH Oman</span>
          <span class="ticker-name">Oman Post</span>
          <span class="ticker-name">HDB Singapore</span>
          <span class="ticker-name">Kanoo Group</span>
          <span class="ticker-name">Cisco</span>
          <span class="ticker-name">HP</span>
          <span class="ticker-name">Adobe</span>
        </div>
      </div>
    </div>`;
}

// ---- Case Studies (Impact section) -----------------------------------------

function buildCaseStudies(caseStudies) {
  const sorted = [...caseStudies].sort((a, b) => (Number(a.meta.priority) || 99) - (Number(b.meta.priority) || 99));

  const cards = sorted.map((cs, idx) => {
    const sections = parseCsBody(cs.body);
    const previewText = (sections.framing || sections.context || cs.body)
      .replace(/<[^>]+>/g, '')
      .replace(/^#+\s*/gm, '')
      .trim()
      .slice(0, 300);

    const metrics = Array.isArray(cs.meta.metrics) ? cs.meta.metrics : [];
    const tags    = Array.isArray(cs.meta.tags)    ? cs.meta.tags    : [];

    const tagPills = tags.slice(0, 3).map(t => `<span class="cs-tag">${t}</span>`).join('');
    const primaryMetric = metrics[0] || '';

    const expandedSections = ['context', 'decision', 'action', 'outcome']
      .filter(k => sections[k])
      .map(k => {
        const label = k.charAt(0).toUpperCase() + k.slice(1);
        return `
          <div class="cs-section">
            <div class="cs-section-label">${label}</div>
            <div class="cs-section-text">${mdToHtml(sections[k])}</div>
          </div>`;
      }).join('');

    const footerMetrics = metrics.slice(0, 3).map(m => `
      <div class="cs-footer-metric">
        <span class="cs-footer-number">${m}</span>
      </div>`).join('');

    return `
      <article class="case-study-card" data-slug="${cs.meta.slug || ''}" data-priority="${cs.meta.priority || 99}">
        <div class="cs-card-top">
          <span class="cs-metric-badge">${primaryMetric}</span>
          <div class="cs-tags">${tagPills}</div>
        </div>
        <h3 class="cs-title">${cs.meta.title}</h3>
        <p class="cs-preview">${previewText}</p>
        <button class="cs-toggle" data-idx="${idx}">Read full story &#9662;</button>
        <div class="cs-expanded" id="cs-exp-${idx}">
          ${expandedSections}
        </div>
        ${footerMetrics ? `<div class="cs-footer">${footerMetrics}</div>` : ''}
      </article>`;
  }).join('\n');

  return `
    <section id="work" class="section-work">
      <div class="container">
        ${buildSectionHeader('01', 'Impact', 'Enterprise wins built on product depth, not sales muscle.')}
        ${buildVisual1()}
        <div class="case-studies-grid" style="margin-top:3rem">
          ${cards}
        </div>
      </div>
    </section>`;
}

// ---- Key Achievements -------------------------------------------------------

function buildKeyAchievements() {
  const items = [
    { number: '$6M',   label: 'ARR grown from zero over 10 years' },
    { number: '96%',   label: 'Customer retention rate (up from 70%)' },
    { number: '35%',   label: 'RFP win rate (up from 14%)' },
    { number: '$25M+', label: 'Pipeline built and managed' },
    { number: '40%',   label: 'Expansion revenue contribution' },
    { number: '40',    label: 'Engineers led across product org' },
    { number: '$1.2M', label: 'M&amp;A acquisition led end-to-end' },
    { number: '18mo',  label: 'Roadmap acceleration via acquisition' },
  ];

  const cards = items.map(item => `
    <div class="achievement-card card">
      <div class="achievement-number">${item.number}</div>
      <div class="achievement-label">${item.label}</div>
    </div>`).join('');

  return `
    <section id="achievements" class="section-achievements">
      <div class="container">
        ${buildSectionHeader('02', 'Key Achievements', 'Numbers with stories behind them.')}
        <div class="achievements-grid">${cards}</div>
      </div>
    </section>`;
}

// ---- On AI + Frameworks -----------------------------------------------------

function buildOnAI(frameworks) {
  const fwCards = frameworks.map(fw => `
    <div class="card" style="padding:2rem;margin-bottom:1.5rem">
      <h3 style="font-size:1.125rem;font-weight:700;margin-bottom:1rem">${fw.meta.title}</h3>
      <div class="fw-body">${mdToHtml(fw.body)}</div>
    </div>`).join('');

  return `
    <section id="thinking" class="section-thinking">
      <div class="container">
        ${buildSectionHeader('03', 'On AI', 'Building AI that earns enterprise trust in regulated markets.')}
        ${buildVisual2()}
        <div style="margin-top:3rem">
          ${buildVisual3()}
        </div>
        ${fwCards ? `<div style="margin-top:3rem">${fwCards}</div>` : ''}
      </div>
    </section>`;
}

// ---- Experience -------------------------------------------------------------

function buildExperience(profile) {
  const roles = [
    {
      dates: '2016 - Present',
      role: 'Sr. Director of Product',
      company: 'Bahwan CyberTek (Dropthought)',
      summary: 'Built AI-CX feedback intelligence platform from $0 to $6M ARR. Scaled enterprise across GCC regulated markets, 40+ engineers. Led Arabic NLP pipeline, $1.2M M&amp;A, 96% retention.',
    },
    {
      dates: '2012 - 2016',
      role: 'Product Manager',
      company: 'Enterprise Software, GCC',
      summary: 'B2B SaaS product management across GCC and Asia markets. CX platform expansion, government and telco verticals.',
    },
    {
      dates: '2010 - 2012',
      role: 'Master of Engineering Management',
      company: 'Dartmouth College (Thayer + Tuck)',
      summary: 'Engineering + business leadership program bridging Thayer School of Engineering and Tuck School of Business.',
    },
    {
      dates: '2003 - 2007',
      role: 'B.E. Electrical and Electronics Engineering',
      company: 'Anna University',
      summary: 'Foundation in systems design and engineering.',
    },
  ];

  const items = roles.map(r => `
    <div class="experience-item">
      <div class="exp-dates">${r.dates}</div>
      <div class="exp-content">
        <div class="exp-role">${r.role}</div>
        <div class="exp-company">${r.company}</div>
        <div class="exp-summary">${r.summary}</div>
      </div>
    </div>`).join('');

  const certs = [
    'CCXP', 'SAFe 6 LPM', 'AWS Cloud Practitioner',
    'AWS AI Practitioner', 'DESC ISR', 'ISO 27001',
  ].map(c => `<span class="cs-tag">${c}</span>`).join(' ');

  return `
    <section id="experience" class="section-experience">
      <div class="container">
        ${buildSectionHeader('04', 'Experience', '14 years across the US, GCC, and Asia.')}
        <div class="experience-list">${items}</div>
        <div style="margin-top:2rem">
          <div style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted);margin-bottom:0.75rem">Certifications</div>
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap">${certs}</div>
        </div>
      </div>
    </section>`;
}

// ---- Testimonials -----------------------------------------------------------

function buildTestimonials(testimonials) {
  const cards = testimonials.map(t => `
    <figure class="testimonial-card">
      <blockquote class="testimonial-quote">${t.body.replace(/^"|"$/g, '').trim()}</blockquote>
      <figcaption>
        <div class="testimonial-initials">${t.meta.initials || ''}</div>
        <div class="testimonial-attribution">
          <strong>${t.meta.name}</strong>
          <span>${t.meta.title}</span>
          ${t.meta.relationship ? `<span>${t.meta.relationship}${t.meta.tenure ? ' &middot; ' + t.meta.tenure : ''}</span>` : ''}
        </div>
      </figcaption>
    </figure>`).join('\n');

  return `
    <section id="people" class="section-people">
      <div class="container">
        ${buildSectionHeader('05', 'From the Team', 'People I have had the privilege of building with.')}
        <div class="testimonials-grid">${cards}</div>
      </div>
    </section>`;
}

// ---- Contact ----------------------------------------------------------------

function buildContact(profile) {
  const { meta } = profile;
  return `
    <section id="contact" class="section-contact footer">
      <div class="container">
        ${buildSectionHeader('06', 'Contact', '')}
        <div class="footer-grid">
          <div>
            <p class="footer-cta-title">Let's build something that matters.</p>
            <div class="footer-links">
              <a href="mailto:${meta.email}" class="footer-link">&#9993; ${meta.email}</a>
              <a href="https://wa.me/${meta.whatsapp}" class="footer-link">&#128241; WhatsApp +${meta.whatsapp}</a>
              <a href="${meta.linkedin}" class="footer-link" target="_blank" rel="noopener">&#128101; LinkedIn Profile</a>
            </div>
          </div>
          <div class="footer-info">
            <p>${meta.name}</p>
            <p>${meta.location}</p>
            <p>Last updated: ${meta.updated}</p>
          </div>
        </div>
      </div>
    </section>`;
}

// ---- CSS --------------------------------------------------------------------

const CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg: #F5F0E8;
    --bg-surface: #FFFFFF;
    --text: #0A0A0A;
    --text-muted: #6B6B6B;
    --accent: #0B6E6E;
    --accent-light: rgba(11,110,110,0.1);
    --border: #0A0A0A;
    --bg-inverse: #0A0A0A;
    --text-inverse: #FFFFFF;
    --font: 'Inter', sans-serif;
  }

  html { scroll-behavior: smooth; font-size: 16px; }

  body {
    background: var(--bg);
    color: var(--text);
    font-family: var(--font);
    line-height: 1.6;
  }

  .container { max-width: 1200px; margin: 0 auto; padding: 0 2rem; }

  /* NAV */
  .nav {
    position: sticky; top: 0; z-index: 100;
    background: var(--bg);
    border-bottom: 1.5px solid var(--border);
    padding: 1rem 0;
  }
  .nav-inner {
    display: flex; align-items: center; justify-content: space-between;
    max-width: 1200px; margin: 0 auto; padding: 0 2rem;
    position: relative;
  }
  .nav-left { font-size: 0.875rem; display: flex; align-items: center; gap: 0.5rem; }
  .nav-left strong { font-weight: 700; }
  .nav-divider { color: var(--text-muted); }
  .nav-role { font-weight: 400; color: var(--text-muted); }
  .nav-center { list-style: none; display: flex; gap: 2rem; }
  .nav-center a { color: var(--text); text-decoration: none; font-size: 0.875rem; font-weight: 500; }
  .nav-center a:hover { color: var(--accent); }
  .nav-right { display: flex; align-items: center; gap: 1rem; }
  .nav-cta {
    display: inline-block;
    background: var(--bg-inverse); color: var(--text-inverse);
    text-decoration: none; padding: 0.5rem 1.25rem;
    font-size: 0.8125rem; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.08em;
  }
  .nav-hamburger { display: none; background: none; border: none; cursor: pointer; font-size: 1.25rem; color: var(--text); }
  .nav-mobile-menu {
    display: none; position: absolute; top: calc(100% + 1rem); right: 0;
    background: var(--bg-surface); border: 1.5px solid var(--border);
    list-style: none; padding: 1rem;
    flex-direction: column; gap: 1rem; min-width: 200px;
  }
  .nav-mobile-menu.open { display: flex; }
  .nav-mobile-menu a { color: var(--text); text-decoration: none; font-size: 0.9375rem; font-weight: 500; display: block; padding: 0.25rem 0; }

  /* HERO */
  .hero { padding: 80px 0; }
  .hero-grid { display: grid; grid-template-columns: 55fr 45fr; gap: 24px; align-items: start; }
  .availability-badge {
    display: inline-flex; align-items: center; gap: 0.4rem;
    padding: 0.4rem 1rem; border: 1.5px solid var(--border); border-radius: 999px;
    font-size: 0.8125rem; font-weight: 500; margin-bottom: 1.5rem;
  }
  .badge-dot { color: var(--accent); }
  .metric-pills { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 1.5rem; }
  .metric-pill {
    display: inline-flex; align-items: center; gap: 0.4rem;
    padding: 0.3rem 0.75rem; border: 1.5px solid var(--border); font-size: 0.875rem;
  }
  .pill-value { font-weight: 700; color: var(--accent); }
  .hero-name { font-size: clamp(48px, 7vw, 72px); font-weight: 800; text-transform: uppercase; line-height: 1.0; margin-bottom: 0.75rem; letter-spacing: -0.02em; }
  .hero-title { font-size: clamp(24px, 3.5vw, 32px); font-weight: 700; color: var(--accent); margin-bottom: 1.25rem; }
  .hero-tagline { font-size: 1.125rem; color: var(--text-muted); max-width: 520px; margin-bottom: 2rem; }
  .hero-ctas { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 2.5rem; }
  .cta-primary {
    display: inline-flex; align-items: center; gap: 0.5rem;
    background: var(--bg-inverse); color: var(--text-inverse);
    text-decoration: none; padding: 16px 32px;
    font-size: 0.875rem; font-weight: 500; text-transform: uppercase; letter-spacing: 0.05em;
  }
  .cta-secondary {
    display: inline-flex; align-items: center; gap: 0.5rem;
    border: 1.5px solid var(--border); color: var(--text);
    text-decoration: none; padding: 16px 32px;
    font-size: 0.875rem; font-weight: 500; text-transform: uppercase; letter-spacing: 0.05em;
  }
  .hero-divider { border: none; border-top: 1px solid var(--border); margin-bottom: 1.5rem; }
  .hero-metrics-bar { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; }
  .metric-item { display: flex; flex-direction: column; gap: 0.25rem; }
  .metric-number { font-size: 1.75rem; font-weight: 700; line-height: 1; }
  .metric-label { font-size: 0.6875rem; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.05em; }

  /* HERO IMAGE */
  .hero-right { display: flex; justify-content: flex-end; }
  /* portrait-outer is sized to hold the image + 14px bleed for the offset frame */
  .portrait-outer {
    position: relative;
    width: 394px;   /* 380 + 14 */
    height: 474px;  /* 460 + 14 */
    flex-shrink: 0;
  }
  /* frame sits behind the image, shifted 14px right and 14px down */
  .portrait-frame {
    position: absolute;
    top: 14px;
    left: 14px;
    width: 380px;
    height: 460px;
    border: 1.5px solid var(--border);
    background: rgba(11,110,110,0.08);
    z-index: 0;
  }
  /* image box clips the photo flush in the top-left of the outer container */
  .portrait-box {
    position: absolute;
    top: 0;
    left: 0;
    width: 380px;
    height: 460px;
    overflow: hidden;
    z-index: 1;
  }
  .portrait-box img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: top center;
    display: block;
  }

  /* CLIENT TICKER */
  .ticker-row { border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); padding: 0.875rem 0; }
  .ticker-inner { max-width: 1200px; margin: 0 auto; padding: 0 2rem; display: flex; align-items: center; gap: 1.5rem; flex-wrap: wrap; }
  .ticker-label { font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); flex-shrink: 0; font-weight: 500; }
  .ticker-names { display: flex; gap: 1.5rem; flex-wrap: wrap; }
  .ticker-name { font-size: 0.875rem; font-weight: 500; color: var(--text-muted); }

  /* SECTIONS */
  section { padding: 80px 0; }
  .section-header { margin-bottom: 3rem; }
  .section-eyebrow { display: flex; align-items: center; gap: 1rem; margin-bottom: 0.75rem; }
  .section-num { font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); flex-shrink: 0; font-weight: 500; }
  .section-rule { flex: 1; height: 1px; background: var(--text-muted); opacity: 0.3; }
  .section-title { font-size: clamp(32px, 5vw, 48px); font-weight: 700; line-height: 1.1; margin-bottom: 0.75rem; }
  .section-subtitle { font-size: 1rem; color: var(--text-muted); max-width: 600px; }

  /* CARD */
  .card { background: var(--bg-surface); border: 1.5px solid var(--border); }

  /* CHARTS */
  .charts-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 1rem; }
  .chart-card { padding: 2rem; }
  .chart-title { font-size: 0.875rem; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; margin-bottom: 1.5rem; }
  .chart-source { font-size: 0.8125rem; color: var(--text-muted); }

  /* RETENTION CHART */
  .retention-chart { display: flex; flex-direction: column; gap: 1.25rem; }
  .retention-row { display: flex; flex-direction: column; gap: 0.4rem; }
  .retention-label-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.25rem; }
  .retention-name { font-size: 0.8125rem; font-weight: 500; }
  .retention-pct { font-size: 0.8125rem; font-weight: 700; }
  .retention-bar-track { height: 40px; background: var(--bg); border: 1px solid var(--border); position: relative; overflow: hidden; }
  .retention-bar-fill { height: 100%; display: flex; align-items: center; justify-content: flex-end; padding-right: 0.5rem; }
  .retention-annotation { font-size: 0.75rem; font-weight: 700; color: var(--bg-surface); }

  /* NLP CHART */
  .nlp-chart-title { font-size: 1.25rem; font-weight: 600; line-height: 1.4; margin-bottom: 2rem; max-width: 500px; }
  .nlp-stages { display: flex; flex-direction: column; gap: 1.5rem; margin-bottom: 1.5rem; }
  .nlp-stage { display: flex; flex-direction: column; gap: 0.5rem; }
  .nlp-stage-header { display: flex; justify-content: space-between; align-items: center; }
  .nlp-stage-name { font-size: 0.8125rem; font-weight: 600; }
  .nlp-stage-pct { font-size: 0.8125rem; font-weight: 700; }
  .nlp-bar-track { height: 12px; background: var(--bg); border: 1px solid var(--border); overflow: hidden; }
  .nlp-bar-fill { height: 100%; }
  .nlp-stage-notes { display: flex; flex-direction: column; gap: 0.15rem; margin-top: 0.25rem; }
  .nlp-note { font-size: 0.75rem; color: var(--text-muted); }
  .nlp-governance { font-size: 0.8125rem; color: var(--text-muted); border-top: 1px solid var(--border); padding-top: 1rem; }

  /* CX MATURITY */
  .maturity-title { font-size: 1.25rem; font-weight: 700; margin-bottom: 0.5rem; }
  .maturity-subtitle { font-size: 0.9375rem; color: var(--text-muted); margin-bottom: 2rem; }
  .maturity-tier { display: flex; align-items: center; gap: 1.5rem; padding: 1.5rem; border-bottom: 1px solid var(--border); }
  .maturity-tier-letter { font-size: 3rem; font-weight: 700; color: var(--accent); width: 3rem; text-align: center; flex-shrink: 0; line-height: 1; }
  .maturity-tier-content { flex: 1; }
  .maturity-tier-name { font-weight: 700; font-size: 1rem; margin-bottom: 0.25rem; }
  .maturity-tier-desc { font-size: 0.875rem; color: var(--text-muted); }
  .maturity-tier-tag { font-size: 0.75rem; padding: 0.25rem 0.75rem; border: 1px solid var(--border); flex-shrink: 0; white-space: nowrap; }
  .maturity-tier-d { background: var(--bg-inverse); border-bottom: none; }
  .maturity-tier-d .maturity-tier-name { color: var(--text-inverse); }
  .maturity-tier-d .maturity-tier-desc { color: rgba(255,255,255,0.6); }
  .maturity-tier-d .maturity-tier-letter { color: var(--accent); }
  .maturity-tier-d .maturity-tier-tag { border-color: rgba(255,255,255,0.3); color: var(--text-inverse); }
  .maturity-note { font-size: 0.8125rem; color: var(--text-muted); padding: 1rem 1.5rem; border-top: 1px solid var(--border); }

  /* CASE STUDIES */
  .case-studies-grid { display: grid; gap: 24px; }
  .case-study-card { background: var(--bg-surface); border: 1.5px solid var(--border); padding: 2rem; }
  .cs-card-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.5rem; }
  .cs-metric-badge { font-size: 0.75rem; font-weight: 600; color: var(--accent); background: var(--accent-light); padding: 0.25rem 0.75rem; }
  .cs-tags { display: flex; gap: 0.4rem; flex-wrap: wrap; }
  .cs-tag { font-size: 0.72rem; color: var(--text-muted); border: 1px solid var(--text-muted); padding: 0.15rem 0.5rem; }
  .cs-title { font-size: 1.25rem; font-weight: 600; margin-bottom: 0.75rem; }
  .cs-preview { font-size: 0.875rem; color: var(--text-muted); margin-bottom: 1rem; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .cs-toggle { background: none; border: none; cursor: pointer; color: var(--accent); font-size: 0.875rem; font-family: var(--font); padding: 0; display: flex; align-items: center; gap: 0.3rem; }
  .cs-expanded { display: none; margin-top: 1.5rem; }
  .cs-expanded.open { display: block; }
  .cs-section { margin-bottom: 1.5rem; padding-left: 1rem; border-left: 3px solid var(--accent); }
  .cs-section-label { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--accent); font-weight: 600; margin-bottom: 0.4rem; }
  .cs-section-text { font-size: 0.875rem; color: var(--text-muted); }
  .cs-section-text p { margin-bottom: 0.5rem; }
  .cs-footer { display: flex; border-top: 1.5px solid var(--border); margin-top: 1.5rem; padding-top: 1.5rem; gap: 0; }
  .cs-footer-metric { flex: 1; display: flex; flex-direction: column; gap: 0.25rem; padding: 0 1rem; border-right: 1px solid var(--border); }
  .cs-footer-metric:first-child { padding-left: 0; }
  .cs-footer-metric:last-child { border-right: none; }
  .cs-footer-number { font-size: 1rem; font-weight: 700; }

  /* KEY ACHIEVEMENTS */
  .achievements-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 24px; }
  .achievement-card { padding: 1.75rem; }
  .achievement-number { font-size: 2.5rem; font-weight: 700; color: var(--accent); line-height: 1; margin-bottom: 0.5rem; }
  .achievement-label { font-size: 0.875rem; color: var(--text-muted); }

  /* FRAMEWORK BODY */
  .fw-body { color: var(--text-muted); font-size: 0.9375rem; }
  .fw-body p { margin-bottom: 0.75rem; }
  .fw-body h2 { color: var(--text); margin: 1.5rem 0 0.5rem; font-size: 1.05rem; font-weight: 700; }
  .fw-body h3 { color: var(--text); margin: 1.2rem 0 0.4rem; font-size: 0.95rem; font-weight: 600; }
  .fw-body strong { color: var(--text); }
  .fw-body ul { padding-left: 1.5rem; margin-bottom: 0.75rem; }
  .fw-body li { margin-bottom: 0.3rem; }
  .fw-body blockquote { border-left: 3px solid var(--accent); padding-left: 1rem; color: var(--accent); font-style: italic; margin: 1rem 0; }
  .fw-body table { width: 100%; border-collapse: collapse; margin: 1rem 0; font-size: 0.88rem; }
  .fw-body th { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1.5px solid var(--border); color: var(--text); font-weight: 600; }
  .fw-body td { padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--border); color: var(--text-muted); }
  .fw-body hr { border: none; border-top: 1px solid var(--border); margin: 2rem 0; }

  /* EXPERIENCE */
  .experience-list { display: flex; flex-direction: column; }
  .experience-item { display: flex; gap: 2rem; padding: 1.5rem 0; border-bottom: 1px solid var(--border); }
  .exp-dates { font-size: 0.8125rem; color: var(--text-muted); min-width: 140px; flex-shrink: 0; padding-top: 0.1rem; }
  .exp-role { font-size: 1rem; font-weight: 600; margin-bottom: 0.2rem; }
  .exp-company { font-size: 0.9375rem; color: var(--accent); margin-bottom: 0.4rem; }
  .exp-summary { font-size: 0.875rem; color: var(--text-muted); }

  /* TESTIMONIALS */
  .testimonials-grid { display: grid; gap: 24px; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
  .testimonial-card { background: var(--bg-surface); border: 1.5px solid var(--border); padding: 1.75rem; display: flex; flex-direction: column; gap: 1.25rem; }
  .testimonial-quote { font-size: 0.9375rem; color: var(--text); line-height: 1.7; font-style: italic; }
  .testimonial-card figcaption { display: flex; align-items: center; gap: 0.875rem; }
  .testimonial-initials { width: 40px; height: 40px; background: var(--accent-light); border: 1.5px solid var(--accent); display: flex; align-items: center; justify-content: center; font-size: 0.8125rem; font-weight: 700; color: var(--accent); flex-shrink: 0; }
  .testimonial-attribution { display: flex; flex-direction: column; gap: 0.1rem; }
  .testimonial-attribution strong { font-size: 0.875rem; }
  .testimonial-attribution span { font-size: 0.8rem; color: var(--text-muted); }

  /* FOOTER / CONTACT */
  .footer { border-top: 1.5px solid var(--border); }
  .footer-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; }
  .footer-cta-title { font-size: 2rem; font-weight: 700; margin-bottom: 2rem; line-height: 1.2; }
  .footer-links { display: flex; flex-direction: column; gap: 0; }
  .footer-link { color: var(--text); text-decoration: none; font-size: 1rem; display: flex; align-items: center; gap: 0.5rem; border-bottom: 1px solid var(--border); padding: 1rem 0; }
  .footer-link:hover { color: var(--accent); }
  .footer-info { display: flex; flex-direction: column; gap: 0.5rem; padding-top: 1rem; }
  .footer-info p { font-size: 0.875rem; color: var(--text-muted); }

  code { font-family: 'Courier New', monospace; font-size: 0.88em; background: var(--bg-surface); padding: 0.1em 0.4em; border: 1px solid var(--border); }

  @media (max-width: 768px) {
    .nav-center { display: none; }
    .nav-cta { display: none; }
    .nav-hamburger { display: block; }
    .hero { padding: 48px 0; }
    .hero-grid { grid-template-columns: 1fr; }
    .hero-right { justify-content: center; order: -1; margin-bottom: 2rem; }
    .portrait-outer { width: 274px; height: 314px; }   /* 260+14 x 300+14 */
    .portrait-frame { width: 260px; height: 300px; }
    .portrait-box   { width: 260px; height: 300px; }
    .hero-metrics-bar { grid-template-columns: repeat(2, 1fr); }
    .charts-grid { grid-template-columns: 1fr; }
    .footer-grid { grid-template-columns: 1fr; }
    .experience-item { flex-direction: column; gap: 0.5rem; }
    .exp-dates { min-width: auto; }
    section { padding: 48px 0; }
    .maturity-tier { flex-wrap: wrap; }
    .maturity-tier-tag { width: 100%; }
  }
`;

// ---- Expand/collapse JS ------------------------------------------------------

const PAGE_JS = `
  document.querySelectorAll('.cs-toggle').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var idx = btn.getAttribute('data-idx');
      var exp = document.getElementById('cs-exp-' + idx);
      var isOpen = exp.classList.toggle('open');
      btn.innerHTML = isOpen ? 'Close story &#9652;' : 'Read full story &#9662;';
    });
  });
`;

// ---- Main build -------------------------------------------------------------

function build() {
  console.log('Building portfolio-os (Bauhaus)...\n');

  const profileRaw  = fs.readFileSync(path.join(CONTENT, 'profile.md'), 'utf8');
  const profile     = parseFrontmatter(profileRaw);

  const statusJsonPath  = path.join(SRC_DATA, 'status.json');
  const routingJsonPath = path.join(SRC_DATA, 'routing.json');

  const statusData  = fs.existsSync(statusJsonPath)  ? JSON.parse(fs.readFileSync(statusJsonPath,  'utf8')) : {};
  const routingData = fs.existsSync(routingJsonPath) ? JSON.parse(fs.readFileSync(routingJsonPath, 'utf8')) : {};

  const caseStudies  = readDir(path.join(CONTENT, 'case-studies'));
  const frameworks   = readDir(path.join(CONTENT, 'frameworks'));
  const testimonials = readDir(path.join(CONTENT, 'testimonials'));

  console.log(`  profile.md         OK`);
  console.log(`  status.json        ${fs.existsSync(statusJsonPath) ? 'OK' : '(fallback)'}`);
  console.log(`  case-studies       ${caseStudies.length} files`);
  console.log(`  frameworks         ${frameworks.length} files`);
  console.log(`  testimonials       ${testimonials.length} files`);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${profile.meta.name} - ${profile.meta.title}</title>
  <meta name="description" content="${profile.meta.tagline}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>${CSS}</style>
</head>
<body>
  ${buildNav()}
  <main>
    ${buildHero(profile, statusData)}
    ${buildCaseStudies(caseStudies)}
    ${buildKeyAchievements()}
    ${buildOnAI(frameworks)}
    ${buildExperience(profile)}
    ${buildTestimonials(testimonials)}
  </main>
  ${buildContact(profile)}
  <script id="portfolio-status" type="application/json">
${JSON.stringify(statusData, null, 2)}
  </script>
  <script id="portfolio-routing" type="application/json">
${JSON.stringify(routingData, null, 2)}
  </script>
  <script>${PAGE_JS}</script>
</body>
</html>`;

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, html, 'utf8');

  const sizeKb = (fs.statSync(OUTPUT_FILE).size / 1024).toFixed(1);
  console.log(`\nOutput: output/index.html (${sizeKb} KB)`);
  console.log('Build complete.\n');

  return {
    caseStudies:  caseStudies.map(c => c.meta.slug),
    frameworks:   frameworks.map(f => f.meta.slug),
    testimonials: testimonials.map(t => t.meta.name),
    sizeKb,
  };
}

build();
