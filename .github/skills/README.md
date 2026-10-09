# Agent skills for this repo

Workflow skills that Copilot (VS Code chat, Copilot CLI, coding agent) loads on demand. Each skill is a folder with a
`SKILL.md`; nothing here is part of the website build, its tests or its deployment.

| Skill | Use it for |
|---|---|
| [ad-funnel-analysis](ad-funnel-analysis/SKILL.md) | Daily or intraday Meta ad → site → GA4 → lead funnel report, per campaign, with what works, what doesn't and why |

## Layout and conventions

```
.github/skills/
  README.md                 this catalog (add a row per skill)
  _shared/                  helpers reused by several skills (no SKILL.md, so it is never loaded as a skill)
    site.example.json       account and property IDs template -> copy to site.local.json (git-ignored)
    EdgeSession.psm1        drive the owner's signed-in Microsoft Edge (Windows UI Automation)
    cloudflare.mjs          Cloudflare GraphQL analytics with the existing Wrangler login
    csv.mjs, config.mjs,    small shared utilities (CSV parsing, config and Wrangler, time zones)
    time.mjs
  <skill-name>/
    SKILL.md                when to use, inputs, procedure, outputs (name must equal the folder name)
    scripts/                deterministic collectors and generators the agent runs
    references/             definitions and playbooks the agent reads on demand
    tests/                  node --test unit tests with synthetic fixtures
```

- **Outputs** go to `reports/<skill-name>/<run-id>/` at the repo root (git-ignored). Never write into `src/`, `public/`,
  `dist/` or `tests/`.
- **Secrets and IDs**: no tokens are stored. Account IDs live in `*.local.json` files, which are git-ignored because
  this repository is public. Templates (`*.example.json`) document the shape.
- **Read-only by default**: skills read Meta, GA4, Cloudflare and D1; they never edit ads, settings or data.
- **No new npm dependencies**: scripts use Node built-ins and PowerShell, so the site's `package.json` stays unchanged.
- **Tests**: `node --test ".github/skills/**/*.test.mjs"` runs every skill's unit tests; the site's Playwright suite is
  untouched.
