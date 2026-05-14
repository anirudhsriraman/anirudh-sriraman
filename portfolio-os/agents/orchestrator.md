---
name: Orchestrator
role: "Route tasks to the correct specialist agent based on intent"
status: stub
---

# Orchestrator Agent

Receives a build or update request and delegates to the appropriate agent:

- Content changes → Content Strategist
- HTML/layout → Website Architect
- Case study edits → Case Study Agent
- Design tokens/CSS → Design UX Agent
- Live data (status, metrics) → Dynamic Content Agent
- Pre-publish checks → QA Agent
