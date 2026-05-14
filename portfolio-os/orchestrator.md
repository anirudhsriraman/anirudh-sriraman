---
name: "Portfolio OS"
version: "0.3.0"
updated: "2026-05-14"
---

# Portfolio OS — Orchestrator

Multi-agent system for maintaining and publishing Anirudh Sriraman's portfolio.

## Agent Map

| Agent | Definition | Script | Status |
|-------|-----------|--------|--------|
| Content Strategist | agents/content-strategist.md | scripts/agents/content-strategist.js | active |
| Website Architect | agents/website-architect.md | scripts/agents/website-architect.js | active |
| Case Study | agents/case-study.md | scripts/agents/case-study.js | stub |
| Design UX | agents/design-ux.md | scripts/agents/design-ux.js | stub |
| Dynamic Content | agents/dynamic-content.md | scripts/agents/dynamic-content.js | stub |
| QA | agents/qa.md | scripts/validate.js | active |
| Orchestrator | agents/orchestrator.md | scripts/orchestrate.js | active |

## Pipeline Sequence

```
content-strategist
      │
      │  writes: handoff/content-strategist-report.md
      ▼
website-architect        ← blocked if content-strategist failed
      │
      │  writes: src/routing.json → triggers build.js → output/index.html
      │  writes: handoff/website-architect-report.md
      ▼
[case-study]             ← runs only when new case study content is added
      │
      ▼
[design-ux]              ← stub: runs when CSS/layout changes are needed
      │
      ▼
[dynamic-content]        ← stub: updates status.md, live metrics
      │
      ▼
qa                       ← gates every deploy: validates output vs content
      │
      ▼
deploy
```

## Handoff Folder

Agents communicate via `/handoff/`. Each agent reads the previous agent's report before running.

| File | Written by | Read by |
|------|-----------|---------|
| `content-strategist-report.md` | content-strategist | website-architect |
| `content-strategist-report.json` | content-strategist | website-architect (gate check) |
| `website-architect-report.md` | website-architect | qa, design-ux |

## Audience Model (6 Personas)

Case studies are scored 0–3 against each persona by `case-study-agent.js`. Scores are written to frontmatter as `scores_<persona>`.

| Persona | Label | Context | Cares About |
|---------|-------|---------|-------------|
| `founder-ceo` | Founder / CEO | AI company, ~$20M | zero-to-one, AI commercialisation, full-stack ownership |
| `recruiter` | Recruiter | Placing senior product leaders | credentials, metrics, tenure, fit-signal |
| `vp-product` | VP of Product | Enterprise B2B SaaS | team-leadership, roadmap-governance, commercial-impact |
| `vp-ai` | VP / Global Head of AI Innovation Lab | Any sector | AI-deployment, production-AI, governance, regulated-markets |
| `vp-dx` | VP of Digital Transformation | Govt, Telco, Retail, Hospitality | change-management, adoption, org-readiness, sector-delivery |
| `vp-cx` | VP of Customer Experience | Govt, Telco, Retail, Hospitality | VoC-architecture, CX-maturity, retention, NPS-to-revenue |

Scoring rules per persona (3 independent signals, each worth +1):

- **founder-ceo:** zero-to-one/startup-to-scale · AI product commercialisation · full P&L/strategy/execution ownership
- **recruiter:** 2+ hard metrics · team scale (headcount/org design) · standard senior PM competency
- **vp-product:** roadmap/portfolio governance · cross-functional leadership · commercial outcome (revenue/win rate/pipeline)
- **vp-ai:** AI/ML/NLP/LLM deployment · accuracy/governance/human-in-the-loop · regulated or enterprise market
- **vp-dx:** change management/adoption/process redesign · org readiness/training · Govt/Telco/Retail/Hospitality sector
- **vp-cx:** VoC/NPS/CSAT/feedback programs · retention/churn/customer health · CX-to-revenue connection

## CLI Commands

```bash
# Full build pipeline: content-strategist → website-architect → qa
node scripts/orchestrate.js --mode=build

# Watch /content/ for changes and re-run pipeline automatically
node scripts/orchestrate.js --mode=watch

# Audit only: run content-strategist and print report (no build)
node scripts/orchestrate.js --mode=audit

# Skip gate checks (bypass content-strategist pass requirement)
node scripts/orchestrate.js --mode=build --force

# Individual agents
node scripts/agents/content-strategist.js
node scripts/agents/website-architect.js [--force]

# Build only (no agent checks)
node scripts/build.js

# QA only
node scripts/validate.js
```

## Content Sources

All content lives in `/content/` as Markdown with YAML frontmatter. No CMS, no database.

| Directory | Section | Required fields |
|-----------|---------|-----------------|
| `content/profile.md` | Hero | name, title, tagline, email, whatsapp, linkedin |
| `content/status.md` | Availability banner | availability, status-label, role-focus |
| `content/case-studies/*.md` | Work | title, slug, audience, metrics, priority, status, scores_founder_ceo, scores_recruiter, scores_vp_product, scores_vp_ai, scores_vp_dx, scores_vp_cx |
| `content/frameworks/*.md` | Thinking | title, slug, type, audience |
| `content/testimonials/*.md` | People | name, title, initials, relationship |
