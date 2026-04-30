# Hot-Path Bug Sweep + Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Audit five hot paths in the Flappy Bert codebase, ship every Critical and Important finding, defer Minor findings to a June log, and deploy the result to production with documented production verification.

**Architecture:** A single Opus audit-lead subagent reads the hot paths and returns a triaged severity report. The user and assistant triage to a final ship list. Each shipped finding gets its own implementer subagent + two-stage review (spec compliance → code quality), running in parallel where files don't collide. All work happens on a worktree branch; one push at the end deploys via Render auto-deploy. CHANGELOG and defer-doc updates close the loop.

**Tech Stack:** Node 20, Express, better-sqlite3, vanilla JS (Canvas mini-app). The existing `tests/tournaments-config.test.js` `node:test` suite is the only automated test surface — fixes that touch tournament-config code MUST keep those tests green.

**Spec:** `docs/superpowers/specs/2026-04-30-hot-path-bug-sweep-design.md`

**Working directory:** All paths absolute. Project root is `/opt/Flappy-Bert/`. Branch and worktree created in Task 1.

**Pre-known input list (do NOT re-discover, just verify):**
- `/api/score` `frames`/`signature` ReferenceError — fixed in commit `f628e78`, deployed.
- Admin-endpoint fail-closed when `API_SECRET` unset — fixed in commit `cfef077`, deployed.
- Duplicate `april-flapoff-2026` row in production SQLite — ops cleanup, not code.
- Markdown injection risk in Telegram tournament caption — Important, must ship.
- `finalGameOver` pill/submit divergence on rollover — Important, must ship.
- Dead code: `getTournamentCountdown()` — Minor, defer.

---

## File Structure

**Files this plan touches deterministically (Tasks 1, 2, 11, 12, 13):**
- Create: `/opt/Flappy-Bert/.worktrees/bug-sweep-2026-04-30/` (worktree on branch `bug-sweep-2026-04-30`)
- Create: `/opt/Flappy-Bert/docs/superpowers/audit-reports/2026-04-30-hot-path-audit.md` (audit-lead output)
- Create: `/opt/Flappy-Bert/docs/superpowers/bugs-defer-to-june.md` (deferred Minor findings)
- Modify: `/opt/Flappy-Bert/CHANGELOG.md` (new 2026-04-30 entry)
- Conditionally modify: `/opt/Flappy-Bert/CLAUDE.md` (only if a fix changes operator-affecting behavior)

**Files Phase 3 fix tasks may touch** (depends on audit output, not pre-determined):
- `/opt/Flappy-Bert/bot.js` — server endpoints, Telegram handlers
- `/opt/Flappy-Bert/db.js` — schema, queries, archive logic
- `/opt/Flappy-Bert/flappy_bert.html` — mini-app frontend
- `/opt/Flappy-Bert/leaderboard-card.js` — server-side card rendering
- `/opt/Flappy-Bert/tournaments-config.js` — config loader (only if audit finds a real bug)

---

## Task 1: Create the bug-sweep worktree

**Files:**
- Create: `/opt/Flappy-Bert/.worktrees/bug-sweep-2026-04-30/`

- [ ] **Step 1: Sanity-check the main repo is clean**

Run: `cd /opt/Flappy-Bert && git status --short`
Expected: only `?? package-lock.json` (pre-existing untracked file). If anything else, stop and surface it.

- [ ] **Step 2: Create the worktree on a new branch**

Run:

```bash
cd /opt/Flappy-Bert
git worktree add .worktrees/bug-sweep-2026-04-30 -b bug-sweep-2026-04-30
```

Expected: `Preparing worktree (new branch 'bug-sweep-2026-04-30')` and `HEAD is now at <SHA> ...`

- [ ] **Step 3: Verify branch + npm install**

```bash
cd /opt/Flappy-Bert/.worktrees/bug-sweep-2026-04-30
git rev-parse --abbrev-ref HEAD
npm install 2>&1 | tail -5
npm test 2>&1 | tail -10
```

Expected: branch name `bug-sweep-2026-04-30`; npm install succeeds (warnings OK); npm test reports `# pass 15 / # fail 0`.

- [ ] **Step 4: No commit yet**

This task does no git commit. The next operations happen in the worktree.

---

## Task 2: Dispatch the audit-lead subagent

**Files:**
- Create: `/opt/Flappy-Bert/.worktrees/bug-sweep-2026-04-30/docs/superpowers/audit-reports/2026-04-30-hot-path-audit.md`

This is a single subagent dispatch. The subagent does its own reads, produces the report file, and reports back.

- [ ] **Step 1: Dispatch the audit-lead subagent (Opus)**

Use the Agent tool with `subagent_type: "general-purpose"` and `model: "opus"`.

Prompt to the subagent (paste verbatim, except substitute the actual session UUID):

```
You are the audit-lead subagent for sub-project #2 of the Flappy Bert improvement effort. Your single job: produce a triaged hot-path audit report and write it to disk. You do NOT propose features. You do NOT propose multi-file refactors. You do NOT propose new tests for code that wasn't tested. You catalogue real bugs.

## Working directory
/opt/Flappy-Bert/.worktrees/bug-sweep-2026-04-30

## Read these files end-to-end
- bot.js (full file, currently ~929 lines)
- db.js (full file, currently ~395 lines)
- flappy_bert.html (script tag and HTML; currently ~3700 lines)
- leaderboard-card.js (full file, ~755 lines)
- tournaments-config.js (full file, currently ~92 lines)

## Trace these 5 hot paths
1. Score submission flow:
   - Mini-app `submitScoreToServer` (flappy_bert.html line ~3676)
   - POST /api/session (bot.js)
   - POST /api/score (bot.js)
   - validateScore (bot.js line ~77)
   - db.submitScore (db.js)
   - db.getWeeklyLeaderboard (db.js)
2. Weekly leaderboard:
   - GET /api/leaderboard
   - GET /api/leaderboard/image (renderLeaderboardCard)
   - Auto-archive cron (bot.js line ~938-960)
   - db.archiveWeek (db.js line ~305)
3. Tournament flow:
   - tournaments.json -> tournaments-config.js -> bot.js startup seed
   - GET /api/tournaments, /api/tournaments/featured, /api/tournament/:id, POST /api/tournament/:id/score
   - flappy_bert.html three-section overlay (showTournament, renderTournamentSections, etc., ~line 3210-3399)
   - Telegram /tournament <keyword> handler (bot.js)
   - Telegram /resettournament admin handler (bot.js)
4. Mini-app rendering:
   - Main menu state (`menuOverlay`, around line 528)
   - Game-over flow (`finalGameOver`, line ~1492; `showGameOverScreen`, line ~1498)
   - Tournament overlay rendering
   - Anti-tamper / Object.defineProperty surface
5. Telegram admin:
   - authMiddleware (bot.js line ~592, post-fail-closed fix)
   - /admin_* commands
   - bot.on('callback_query') handlers

## Pre-known findings to verify (do NOT re-flag, just confirm they're closed)
- /api/score frames/signature ReferenceError — already fixed in commit f628e78 — confirm by reading the current code.
- Admin endpoints fail-closed when API_SECRET unset — already fixed in commit cfef077 — confirm by reading authMiddleware.
- Duplicate april-flapoff-2026 row in production SQLite — operations cleanup, not code; do NOT flag in the audit.
- Markdown injection in /tournament Telegram caption (bot.js, search "renderTournamentCard" caller) — Important, INCLUDE in report.
- finalGameOver pill/submit divergence — Important, INCLUDE in report.
- Dead code: getTournamentCountdown() — Minor, INCLUDE in report.

## Severity tiers
- **Critical**: data loss, security (auth bypass, secret leak, XSS), total feature break, money/auth correctness.
- **Important**: wrong-but-functional behavior; observable bug a player or operator would file; broken visual layout (illegible, off-screen, mobile-broken, missing required focus/hover); off-by-one in user-facing data; measurable perf regression.
- **Minor**: cosmetic, dead code, redundant code, log noise, would-be-nice cleanup, refactor candidates.

If you can't decide between Important and Minor, ask: would a player or the operator file this if they saw it? Yes -> Important. They'd shrug -> Minor.

## Output format

Write a single Markdown file to:
/opt/Flappy-Bert/.worktrees/bug-sweep-2026-04-30/docs/superpowers/audit-reports/2026-04-30-hot-path-audit.md

Use exactly this structure:

```
# Hot-path audit — 2026-04-30

## Coverage table
| Hot path | Files read | Approx lines covered |
|----------|-----------|----------------------|
| 1. Score submission | bot.js, db.js, flappy_bert.html | bot.js NN-MM, db.js NN-MM, html NN-MM |
| 2. Weekly leaderboard | bot.js, db.js, leaderboard-card.js | ... |
| 3. Tournament flow | bot.js, db.js, tournaments-config.js, flappy_bert.html | ... |
| 4. Mini-app rendering | flappy_bert.html | ... |
| 5. Telegram admin | bot.js, db.js | ... |

## Findings

### Critical (N)
- **C1: <one-line title>**
  - Location: `file:line` (e.g., `bot.js:123`)
  - Problem: <what is wrong, observable by whom>
  - Root cause: <why it's wrong; cite the relevant lines>
  - Proposed fix: <one-paragraph approach; do not write code, describe the fix>
  - Effort: S | M | L
  - Production reproduction: <one-line curl or manual repro that demonstrates the bug today>

(repeat for each Critical)

### Important (N)
- **I1: ...** (same shape)

### Minor (N)
- **M1: ...** (same shape; effort-estimate is mostly informational for these)

## Coverage gaps (if any)
List any subsection of a hot path you couldn't fully trace, with a one-line reason. Empty section if none.

## Notes
Anything notable that didn't rise to a finding (good patterns, well-tested areas, the codebase's general state). Keep this section short.
```

## Constraints
- Effort tiers: S = ~30 min implementation, M = 1-2 hours, L = half-day or more.
- Per-finding location MUST be a `file:line` ref. If a finding spans multiple lines, use the start line and note "lines NN-MM" in the location.
- Production reproduction: a real curl command, real Telegram message, or real reproduction sequence — not "load the page and observe."
- Be honest. If a hot path looks clean, the report can have 0 findings in that path. Don't pad.
- Cap the report at ~20 findings total. If you find more, raise the bar (some "important" become "minor"); the user is operating on a 1-day budget.
- Do NOT propose features, refactors, new tests, or "while I'm in here" cleanups.

## Final step
After writing the file, return a short report:
- Total findings count by tier (Critical: N, Important: N, Minor: N)
- The file path you wrote
- Whether any hot path had a coverage gap
```

- [ ] **Step 2: Verify the audit file exists**

```bash
cd /opt/Flappy-Bert/.worktrees/bug-sweep-2026-04-30
ls -la docs/superpowers/audit-reports/2026-04-30-hot-path-audit.md
wc -l docs/superpowers/audit-reports/2026-04-30-hot-path-audit.md
```

Expected: file exists; line count is reasonable (>50, <500). If empty or absent, the subagent failed — re-dispatch with clearer instructions.

- [ ] **Step 3: Commit the audit report**

```bash
cd /opt/Flappy-Bert/.worktrees/bug-sweep-2026-04-30
git add docs/superpowers/audit-reports/2026-04-30-hot-path-audit.md
git -c user.name="Developer" -c user.email="dev@drinkerlabs.info" commit -m "docs(audit): hot-path audit report — 2026-04-30"
```

The commit captures the audit-lead's findings as the input to triage. If we re-trigger the audit later (different scope, fresh perspective), we have a baseline.

---

## Task 3: Triage with the user

**Files:** None (decision-making step).

- [ ] **Step 1: Read the audit report**

```bash
cd /opt/Flappy-Bert/.worktrees/bug-sweep-2026-04-30
cat docs/superpowers/audit-reports/2026-04-30-hot-path-audit.md
```

- [ ] **Step 2: Present the audit summary to the user**

In the terminal, show:
- Total findings by tier
- The titles of every Critical and Important finding (one line each)
- The titles of every Minor finding (one line each)
- Any coverage gaps the audit flagged

Format:

```
Audit complete. Findings:
  Critical: N
  Important: N
  Minor: N

Default cut: Critical + Important ship; Minor defer.

Critical:
  - C1: <title>
  - C2: ...

Important:
  - I1: <title>
  - I2: ...

Minor (would defer):
  - M1: <title>
  - ...
```

Then ask the user: "Anything to override? Bump a Minor to ship, defer an Important, or skip a Critical (with reason)?"

- [ ] **Step 3: Lock the cut decision**

Capture the final ship-list and defer-list. Output a clear summary back to the user:

```
Triaged. Ship list (N items):
  C1, C2, I1, I2, ...

Defer list (M items):
  M1: <title> — reason: <default minor / user-deferred-with-reason>
  ...
```

Wait for the user to confirm before continuing to Task 4.

If the audit returned >12 ship-list findings even after cuts, raise it: "12+ items on the ship list — that's beyond the 1-day budget. Cut another N items, or accept ~2 days?" Wait for explicit user reply before proceeding.

- [ ] **Step 4: Write the defer doc**

Create `/opt/Flappy-Bert/.worktrees/bug-sweep-2026-04-30/docs/superpowers/bugs-defer-to-june.md` with the content:

```markdown
# Deferred bugs — to be considered in June creative pass

This file holds the Minor (and any explicitly user-deferred Important) findings from the 2026-04-30 hot-path audit. They didn't justify a hotfix today; they may or may not justify work in the June pass.

## Findings (deferred 2026-04-30)

[For each deferred finding, copy from the audit report:]

### M1: <title>
- **Location:** `file:line`
- **Problem:** <copy from audit>
- **Root cause:** <copy from audit>
- **Proposed fix:** <copy from audit>
- **Effort:** S | M | L
- **Why deferred:** Default Minor. (Or a user reason if explicitly deferred.)

[continue for each]

## Notes
- Format: each finding gets its own H3 with the audit's original ID.
- When a deferred item is revisited in June (or wherever), update the entry with the resolution: `**Resolved:** <commit SHA / decision>` or remove the entry and link to a CHANGELOG line.
```

Commit it:

```bash
cd /opt/Flappy-Bert/.worktrees/bug-sweep-2026-04-30
git add docs/superpowers/bugs-defer-to-june.md
git -c user.name="Developer" -c user.email="dev@drinkerlabs.info" commit -m "docs(defer): seed bugs-defer-to-june.md with audit's deferred findings"
```

---

## Task 4 onwards: Per-finding fix tasks (filled after triage)

Each shipped finding becomes one task slot. The slot follows the same template across all of them — only the contents (the finding ID, file references, fix text, reproduction command) change. The plan-author at execution time fills the slots from the triaged audit before dispatching.

The number of fix-tasks (Task 4 through Task N) equals the size of the ship list. Each fix is independently reviewed; they MUST commit independently so a per-fix revert is one `git revert <SHA>`.

### Per-fix task template

Every fix task uses this exact structure. Substitute `{finding_id}`, `{title}`, `{file:line}`, `{fix_summary}`, `{reproduction}`, `{verification}` from the audit report.

```markdown
### Task X: {finding_id} — {title}

**Files:**
- Modify: {file_paths_from_finding}

**Findings reference:** {finding_id} from the audit report at `docs/superpowers/audit-reports/2026-04-30-hot-path-audit.md`.

- [ ] **Step 1: Dispatch implementer subagent**

Use the Agent tool with `subagent_type: "general-purpose"` and `model: "opus"`.

Prompt:

```
You are implementing fix {finding_id} from the 2026-04-30 hot-path audit of Flappy Bert.

## Working directory
/opt/Flappy-Bert/.worktrees/bug-sweep-2026-04-30

## The finding
[paste the FULL text of the finding from the audit report — Location, Problem, Root cause, Proposed fix, Effort, Production reproduction]

## Your job
1. Apply ONLY the fix described in "Proposed fix". Do not refactor surrounding code. Do not fix nearby bugs you spot. Do not add tests for code that wasn't tested (only update tests if you're touching code that already has tests).
2. If a fix is more nuanced than the audit captured, ask before deviating.
3. Manually reproduce the bug using the "Production reproduction" command BEFORE the fix to confirm you can hit it locally. Then apply the fix. Then re-run the reproduction to confirm the bug is gone.
4. If the bug only reproduces in production (e.g., needs a real Telegram identity), skip the local reproduction; note this in your report.
5. Run `npm test` after the fix. If any test fails, stop and report — the fix may have regressed something.
6. Commit with the message: `fix({area}): {finding_id} — {title}` followed by a short body explaining the cause and the fix.
   Use the `-c user.name="Developer" -c user.email="dev@drinkerlabs.info"` flags so the worktree commit author is consistent.

## Constraints
- One file change per fix unless the audit explicitly calls out multiple files.
- Use `textContent`, NOT `innerHTML`, for any new mini-app rendering of operator/user data (consistent with the rest of the codebase post-Tournament Framework v2).
- Keep the diff minimal. The reviewer prefers a 5-line fix over a 50-line "while I'm in here" cleanup.

## Self-review before reporting back
- [ ] The fix matches the audit's "Proposed fix" — no scope creep
- [ ] `npm test` is green
- [ ] The local repro (or production-only repro note) is documented
- [ ] One commit on HEAD with the {finding_id} in the subject

## Report format
- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- The git diff stat (e.g., `bot.js | 3 ++-`)
- The commit SHA + subject (`git log --oneline -1`)
- Whether you reproduced the bug locally before fixing (yes/no/N/A with reason)
- Any concerns
```

- [ ] **Step 2: Spec compliance review**

Use the Agent tool with `subagent_type: "general-purpose"` and `model: "opus"`.

Prompt:

```
You are reviewing the fix for {finding_id} ({title}) from the 2026-04-30 Flappy Bert hot-path audit.

## What was requested
[paste the FULL audit finding]

## What the implementer claims
[paste the implementer's report]

## Verify independently
1. Read the diff: `cd /opt/Flappy-Bert/.worktrees/bug-sweep-2026-04-30 && git show {commit_sha}`
2. Read the modified file(s) at the commit's HEAD state.
3. Confirm the fix EXACTLY matches the audit's "Proposed fix" — no scope creep, no missed pieces, no incidental refactors.
4. Confirm the diff doesn't introduce new XSS surfaces (innerHTML for user/operator data), new ReferenceErrors, or new failure modes.
5. Confirm `npm test` is still green: `cd /opt/Flappy-Bert/.worktrees/bug-sweep-2026-04-30 && npm test 2>&1 | tail -5`.

## Report
- ✅ Spec compliant — proceed to code quality review
- ❌ Issues: [list with file:line references]
```

If issues, dispatch a follow-up implementer to fix them, then re-review. Iterate until ✅.

- [ ] **Step 3: Code quality review**

Use the Agent tool with `subagent_type: "superpowers:code-reviewer"` and `model: "opus"`.

Prompt:

```
Code quality review of fix {finding_id} from the 2026-04-30 Flappy Bert hot-path audit.

## What was implemented
{one-paragraph description of the fix}

## Audit reference
{finding_id} in `docs/superpowers/audit-reports/2026-04-30-hot-path-audit.md`.

## Range
- BASE_SHA: {commit before this fix}
- HEAD_SHA: {this fix's commit}

Run: `cd /opt/Flappy-Bert/.worktrees/bug-sweep-2026-04-30 && git diff {base}..{head}`

## What to assess
- Is the fix minimal and focused?
- Does it follow project conventions (textContent for user/operator data, error-handling style of the surrounding code, consistent commit message style)?
- Did the implementer accidentally introduce a new bug, change behavior beyond the finding, or leave dead code behind?
- Does the diff make sense to a reviewer who doesn't know the audit context?

Report: Strengths / Issues (Critical/Important/Minor) / Assessment.
```

If reviewer flags issues, dispatch follow-up implementer, then re-review. Iterate until approved.

- [ ] **Step 4: Mark task complete**

Update task status; record the commit SHA in the running ship-list summary.
```

The plan-author at execution time creates Task 4 through Task N (one per ship-list item) by copying this template and filling in the placeholders.

---

## Task X+1: Final pre-deploy verification

**Files:** None (verification only).

- [ ] **Step 1: All tests still green**

```bash
cd /opt/Flappy-Bert/.worktrees/bug-sweep-2026-04-30
npm test 2>&1 | tail -10
```

Expected: `# pass 15 / # fail 0`. If any test fails, return to the offending fix's task and fix it before proceeding.

- [ ] **Step 2: Smoke-start the bot**

```bash
cd /opt/Flappy-Bert/.worktrees/bug-sweep-2026-04-30
pkill -9 -f "node bot.js" 2>/dev/null
sleep 2
rm -f flappy_bert.db flappy_bert.db-shm flappy_bert.db-wal
BOT_TOKEN=fake /usr/bin/node bot.js > /tmp/bug-sweep-smoke.log 2>&1 &
SMOKE_PID=$!
sleep 3
head -8 /tmp/bug-sweep-smoke.log
```

Expected: log shows `Loaded 3 tournament(s) from config`, `🌐  API server running on port 3000`, no `Error:` lines before the polling errors. The polling errors after that are expected (dummy token).

- [ ] **Step 3: Curl-verify each fix's local reproduction**

For each shipped fix, run the post-fix verification command from the audit report (the inverse of the production reproduction). Expected behaviors are documented per-fix.

If a fix can't be locally verified (e.g., needs Telegram identity), mark it `pending production verify`.

- [ ] **Step 4: Stop the local bot**

```bash
kill -9 $SMOKE_PID 2>/dev/null
sleep 1
ss -tlnp 2>&1 | grep :3000 || echo "port 3000 free"
```

Expected: port free.

- [ ] **Step 5: No commit (verification only)**

---

## Task X+2: Merge and deploy

**Files:**
- Modify: `/opt/Flappy-Bert/CHANGELOG.md`

- [ ] **Step 1: Update CHANGELOG.md on the worktree branch**

Open `/opt/Flappy-Bert/.worktrees/bug-sweep-2026-04-30/CHANGELOG.md`. At the top of the file (after any existing header/preamble), insert a new section:

```markdown
## 2026-04-30 — Hot-path bug sweep

Triaged + shipped findings from the 2026-04-30 hot-path audit (`docs/superpowers/audit-reports/2026-04-30-hot-path-audit.md`).

### Critical
- {C1 finding ID and title} — `{commit_sha}`
- (continue for each)

### Important
- {I1 finding ID and title} — `{commit_sha}`
- (continue for each)

### Deferred to June
- See `docs/superpowers/bugs-defer-to-june.md`.
```

Use the actual ship list from Task 3 to fill in the IDs and SHAs.

- [ ] **Step 2: Commit the CHANGELOG entry**

```bash
cd /opt/Flappy-Bert/.worktrees/bug-sweep-2026-04-30
git add CHANGELOG.md
git -c user.name="Developer" -c user.email="dev@drinkerlabs.info" commit -m "docs(changelog): 2026-04-30 hot-path bug sweep entries"
```

- [ ] **Step 3: Update CLAUDE.md if needed**

For each shipped fix, ask: does this fix change behavior the operator needs to know about? (E.g., a new env var, a renamed admin command, a different rate-limit threshold.)

If yes for any fix, update `CLAUDE.md` and commit:

```bash
cd /opt/Flappy-Bert/.worktrees/bug-sweep-2026-04-30
git add CLAUDE.md
git -c user.name="Developer" -c user.email="dev@drinkerlabs.info" commit -m "docs(claude-md): update operator notes after bug sweep"
```

If no fixes change operator-facing behavior, skip this step.

- [ ] **Step 4: Fast-forward merge to main**

```bash
cd /opt/Flappy-Bert
git status --short
```

Expected: only `?? package-lock.json` (pre-existing). If anything else, stop and reconcile.

```bash
cd /opt/Flappy-Bert
git merge --ff-only bug-sweep-2026-04-30
git log --oneline main..origin/main 2>/dev/null
git log origin/main..main --oneline | wc -l
```

Expected: fast-forward succeeds; `main..origin/main` is empty (no upstream changes since last push); the wc-l line shows the count of new commits this push will deliver.

- [ ] **Step 5: Push to origin (triggers Render auto-deploy)**

```bash
cd /opt/Flappy-Bert
git push origin main
```

Expected: `<old_sha>..<new_sha>  main -> main`.

- [ ] **Step 6: Wait for Render deploy**

Use the Bash tool with `run_in_background: true`. The polling loop hits a fingerprint endpoint (e.g., `/api/health` or `/api/tournaments/featured`) until the new deploy is live. Use `until` and a short sleep, max ~5 minutes.

Suggested fingerprint check (adjust to whichever endpoint changed if any fix touches it):

```bash
until curl -sf https://flappy-bert.onrender.com/api/health 2>/dev/null | grep -q '"ok":true'; do sleep 15; done
echo "deploy live"
```

If the deploy fails (Render shows build failure or 502s persist >5 min), revert the merge:

```bash
cd /opt/Flappy-Bert
git push origin +<previous_main_sha>:main
```

Then investigate locally before retrying.

- [ ] **Step 7: Production verify each shipped fix**

Run the post-fix verification command for every shipped fix against `https://flappy-bert.onrender.com/...`. Capture results in a Markdown table:

```
| Finding | Verified | Notes |
|---------|----------|-------|
| C1 | ✅ | curl returned ok |
| I1 | ✅ | leaderboard reflects |
| ... | | |
```

If any verification fails, immediately revert the offending commit on main, push, redeploy, and re-investigate.

- [ ] **Step 8: Clean up the worktree**

```bash
cd /opt/Flappy-Bert
git worktree remove --force .worktrees/bug-sweep-2026-04-30
git branch -d bug-sweep-2026-04-30
git worktree list
```

Expected: only the main worktree at `/opt/Flappy-Bert` remains; the `bug-sweep-2026-04-30` branch is deleted (was merged into main).

---

## Self-review checklist (run by plan-author before handoff)

- [ ] Spec section "Phase 1 — AUDIT" → covered by Task 2
- [ ] Spec section "Phase 2 — TRIAGE" → covered by Task 3
- [ ] Spec section "Phase 3 — FIX" → covered by Task 4..N (per-fix template at the top of "Task 4 onwards")
- [ ] Spec section "Phase 4 — DEPLOY" → covered by Task X+1 (verification) + Task X+2 (merge/deploy/verify-prod)
- [ ] Spec section "Phase 5 — DOCUMENT" → covered by Task 3 step 4 (defer doc), Task X+2 steps 1-3 (CHANGELOG + optional CLAUDE.md)
- [ ] Pre-known input list referenced in Task 2 prompt — yes
- [ ] Severity definitions referenced in Task 2 prompt — yes
- [ ] Time budget signal (>12 ship-list items) referenced in Task 3 step 3 — yes
- [ ] Production rollback plan referenced in Task X+2 step 6 — yes
- [ ] No placeholders, no "TBD" — verified by hand
- [ ] Function/property names are consistent: `validateScore`, `submitScore`, `getWeeklyLeaderboard`, `archiveWeek`, `authMiddleware`, `getFeaturedTournament` — match the codebase
- [ ] Production fingerprint endpoint mentioned (use `/api/health`, which exists per `bot.js:920`)
- [ ] Worktree branch name (`bug-sweep-2026-04-30`) is consistent across all tasks
