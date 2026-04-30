# Hot-Path Bug Sweep + Polish — Design

**Date:** 2026-04-30
**Owner:** Dr. Inker LABS
**Status:** Spec — pending implementation
**Type:** Bug-fix pass (Option A from sub-project #2 brainstorm). Larger creative pass (Option C) deferred to June.

## Problem

Today's session surfaced two real production bugs hiding for ~30 days (`/api/score` ReferenceError → empty weekly leaderboard; admin endpoints unauthenticated when `API_SECRET` unset). Both were one-line fixes that nobody noticed because nobody had recently audited the hot paths. The codebase is a mostly mechanical Node/Express + vanilla-JS mini-app with no automated coverage outside the new tournament-config tests, so regressions sit silently until a player or operator stumbles on the symptom.

This spec captures one focused bug-sweep pass before the June creative push — to clear the deck, build operator trust in the deploy, and make sure the May tournament rolls over on a clean foundation.

## Goals

1. Audit five hot paths end-to-end with one Opus subagent and produce a triaged severity-ranked findings report.
2. Ship every Critical and Important finding within ~1 working day of effort.
3. Defer Minor findings to a `bugs-defer-to-june.md` log so they're not lost but don't bloat this pass.
4. Land each fix as its own commit on a feature branch via two-stage review (spec compliance + code quality), matching the workflow that proved out today.
5. Ship deploys that we can manually verify against production within 10 minutes.

## Non-goals

- No new gameplay features. JEETS variations, new power-ups, lore, themes, etc. are out of scope.
- No proactive aesthetic redesign. Visual *breakage* (broken layouts, illegible text, mobile-broken elements, missing hover/focus states, animations that jank) is in scope; *unattractive but functional* is not.
- No retroactive unit-test bootstrapping for code that wasn't already tested. The tournament-config tests stay green; we don't add new test infrastructure for legacy code.
- No restructure or refactor. Inline fixes only; the file structure that exists today stays.

## Architecture

### Phase 1 — AUDIT

A single Opus subagent (the "audit lead") reads `bot.js`, `db.js`, `flappy_bert.html`, and `leaderboard-card.js` end-to-end and traces these five hot paths:

1. **Score submission flow** — `/api/session` → mini-app `submitScoreToServer` → `/api/score` (validation, DB write) → leaderboard render.
2. **Weekly leaderboard** — query path, sorting, displayed fields, the auto-archive cron at `bot.js:938-960`, and the archive CSV writer in `db.js:archiveWeek`.
3. **Tournament flow** — config seed at startup, `/api/tournaments`, `/api/tournaments/featured`, `/api/tournament/:id`, `/api/tournament/:id/score`, the mini-app three-section overlay, the Telegram `/tournament` command, the operator `/resettournament` admin command.
4. **Mini-app rendering** — main menu state transitions, game-over flow, tournament overlay rendering, anti-tamper / anti-cheat surface.
5. **Telegram admin commands** — auth middleware (post-fail-closed fix), `/admin_*` commands and their bodies, callback queries.

The audit lead produces a single Markdown report with the structure below. For each finding, the report MUST include `file:line` references, root cause, proposed fix, and an effort estimate (S = ~30 min, M = 1-2 hours, L = half-day+).

```markdown
# Hot-path audit — 2026-04-30

## Coverage
- Files read: bot.js (lines 1-960), db.js (full), flappy_bert.html (lines NNNN-MMMM)
- Hot paths covered: 1, 2, 3, 4, 5
- Hot paths NOT covered (with reason): <none expected>

## Findings

### Critical (N)
- **C1: <title>**
  Location: `file:line`
  Problem: <what's wrong>
  Root cause: <why>
  Proposed fix: <one-paragraph approach>
  Effort: S | M | L

### Important (N)
- **I1...** (same shape)

### Minor (N)
- **M1...** (same shape)
```

The audit lead does NOT propose multi-file refactors, does NOT propose new features, does NOT propose tests for code that wasn't tested. If they spot one, it goes under Minor with a note "deferred — refactor candidate."

### Phase 2 — TRIAGE

User and assistant read the audit report together (~10 minutes).

**Default cut line:** Critical + Important ship in this pass; Minor defer to June.

User can override either direction:
- "Ship M3 too" → moves Minor to ship list.
- "Defer I2" → moves Important to defer list (with reason captured in the defer doc).
- "Skip C1" → only valid if the user explicitly accepts the risk; the reason is captured in the defer doc and the spec.

The cut decisions become the input to Phase 3.

### Phase 3 — FIX

Assistant orchestrates from terminal. For each finding to ship:

1. Spawn an "implementer" Opus subagent with: the audit finding (full text), the proposed fix, file paths to modify, the relevant surrounding context, and instructions to follow the existing project conventions.
2. Implementer applies the fix, smoke-tests if applicable (curl, npm test, manual frontend reproduction), and commits with a message that names the finding ID (e.g., `fix(score): C1 — frames/signature ReferenceError ...`).
3. Spawn a "spec compliance" reviewer subagent that re-reads the finding and the diff, and verifies the diff implements ONLY what the audit asked for (no scope creep, no missed pieces).
4. Spawn a "code quality" reviewer subagent (`superpowers:code-reviewer`) that catches XSS gaps, naming, decomposition, error paths, etc.
5. If either reviewer flags issues, dispatch a follow-up implementer to fix them, then re-review. Iterate until both reviewers approve.

**Parallelism:** Independent fixes (different files, no shared state) dispatch in parallel batches of up to 3. Fixes that touch the same file (e.g., multiple bot.js changes) dispatch sequentially to avoid merge conflicts.

**Branch:** All work happens on `bug-sweep-2026-04-30` in a worktree at `.worktrees/bug-sweep-2026-04-30`. Main stays clean until Phase 4.

### Phase 4 — DEPLOY

1. Final `npm test` pass on the branch — must be green (15/15).
2. Smoke-start the bot locally (`BOT_TOKEN=fake node bot.js`) and confirm: the `Loaded N tournament(s) from config` line appears, the API server binds port 3000, and no `Error:` lines are emitted before the Telegram polling errors begin (those polling errors are expected with the dummy token).
3. Fast-forward merge `bug-sweep-2026-04-30` → `main`.
4. Single push to origin. Render auto-deploys.
5. Wait for deploy by polling `/api/health` or a unique fingerprint endpoint.
6. Run a "production verify" pass: each fix has a documented one-line reproduction command. Run all of them and confirm the post-fix behavior in production. Record results.
7. If any production verify fails, immediate revert: `git revert HEAD` (or specific commit), push, Render redeploys. Re-investigate locally before retrying.

### Phase 5 — DOCUMENT

1. **CHANGELOG.md** — add a new section dated 2026-04-30 listing each shipped fix as a one-line entry with finding ID and commit SHA.
2. **docs/superpowers/bugs-defer-to-june.md** — add (or update) with each deferred finding, its effort estimate, and a one-sentence "why deferred" note. This becomes one of the inputs to the June creative-pass brainstorm.
3. **CLAUDE.md** — update only if a fix changes operator-affecting behavior (e.g., a new env var, a renamed admin command, a behavior change in the rate limiter). Most fixes will NOT touch CLAUDE.md.

## Severity definitions

| Tier | Definition | Default disposition |
|------|-----------|---------------------|
| Critical | Data loss; security (auth bypass, secret leak, XSS); total feature break (an endpoint that throws on every call); money/payment correctness | SHIP |
| Important | Wrong-but-functional behavior; observable bug a player or operator would notice; broken visual layout (illegible, off-screen, mobile-broken, missing hover/focus where required); off-by-one in user-facing data; performance regression that's measurable | SHIP |
| Minor | Cosmetic; dead code; redundant code; log noise; "would-be-nice" cleanup; documentation-only fixes; refactor candidates | DEFER to June |

The line between Important and Minor is empirical: would a player or the operator file this if they saw it? If yes → Important. If they'd shrug → Minor.

## Pre-known input list

These are findings already surfaced today that the audit lead does NOT need to re-discover; they should be treated as in-flight (track them but don't double-up):

- `/api/score` ReferenceError on `frames`/`signature` (already fixed, commit `f628e78` — VERIFY only)
- Admin endpoints unauthenticated when `API_SECRET` unset (already fixed, commit `cfef077` — VERIFY only; pending operator setting `API_SECRET` in Render dashboard, which is the user's task)
- Duplicate `april-flapoff-2026` row in production SQLite (cosmetic; needs ops cleanup, not code change — flag in defer doc)
- Markdown injection risk in Telegram tournament caption (operator-supplied `name`/`sponsor` interpolated into Markdown — Important, ship in this pass)
- `finalGameOver` line ~1615 reads `getTournamentStatus()` (Featured-state-based) while submit reads `ALL_TOURNAMENTS.find(t => t.status === 'live')` — pill/submit can disagree at rollover boundaries (Important, ship)
- Dead code: `getTournamentCountdown()` at `flappy_bert.html:3208` has no callers (Minor, defer)

The audit lead receives this list as input and is told: do not re-flag these; verify in pass 1 and add Critical/Important fixes that aren't on this list.

## Time budget

| Phase | Effort | Elapsed |
|-------|--------|---------|
| Audit | ~3 hours | ~3 hours |
| Triage | ~10 min (user + me) | ~10 min |
| Fix | ~4-8 hours | ~6-10 hours (parallelism helps) |
| Deploy + verify | ~30 min | ~45 min (Render deploy ~2 min) |
| Document | ~30 min | ~30 min |
| **Total** | **~1 working day** | **~1.5 days** |

If the audit returns more than ~12 findings to ship, the spec author (i.e., this document's author at execution time) re-presents the cut line to the user before starting Phase 3 — better to defer some Important than blow the time budget by 2x.

## Risks and mitigations

| Risk | Mitigation |
|------|-----------|
| Audit subagent misses a hot-path bug | Audit lead must include a "Coverage" section listing exactly which files/lines were read for each hot path; gaps surface immediately |
| Fix introduces a regression in production | Each fix has a documented production-reproduction command run during Phase 4; rollback is a single revert + push (<5 min) |
| Scope creep into "while I'm in here let me also..." | Implementer subagents are instructed to fix ONLY the specific finding; reviewer rejects scope additions; "while I'm in here" candidates go to defer list |
| Multi-file fix touches an in-flight fix's file | Phase 3 parallelism budget capped at 3, file-collision check before each batch |
| Production smoke-tests need real BOT_TOKEN that I don't have | Manual repros use only public endpoints (curl) or operator endpoints we have keys for; nothing requires Telegram identity |
| User catches a should-have-been-Critical that audit ranked Minor | Triage step is collaborative; user can rebucket; defer doc captures rebucketing decisions |

## Success criteria

After Phase 5 completes:

1. All Critical + Important findings (default cut) are deployed and production-verified.
2. `CHANGELOG.md` has a 2026-04-30 entry naming each fix.
3. `bugs-defer-to-june.md` has every Minor finding with ID, location, and effort estimate.
4. `npm test` is green on main.
5. Hot path manual smoke against production passes (score submission → leaderboard reflects, tournament endpoint returns expected, admin endpoint with secret returns 200, without secret returns 401, without secret-set returns 503).
6. The user has a clear list of "things still to do in June" that's already triaged.

## Out of scope (explicit)

- Adding tests for legacy code paths
- Refactoring `bot.js` or `flappy_bert.html` to split files (those are recurring "wouldn't it be nice" thoughts that fail YAGNI today)
- Visual polish beyond breakage (gradients, animations, color-tweak passes — June)
- New gameplay features, themes, lore — June
- Auto-retrying score submission on network failure (interesting but not a bug — June if it makes the cut)
- Markdown injection hardening across the entire codebase — only the Telegram tournament caption is in scope this pass; other Markdown surfaces are flagged for review but not mandated

## Approval log

- 2026-04-30: User selected Option A (targeted polish & bug sweep) over B (themed feature push) and C (open-ended creative). Said "C in June" → larger pass deferred.
- 2026-04-30: User selected hot-path scope B (5 hot paths) over A (full sweep) and C (critical only).
- 2026-04-30: User selected agent shape C (audit-lead subagent + assistant-orchestrated fixes) over A (assistant-only) and B (lead subagent owns everything).
- 2026-04-30: User selected polish budget B (logic + visual breakage; no proactive aesthetic) over A (logic only) and C (logic + breakage + 2-3 nice-to-haves).
- 2026-04-30: User approved this design.
