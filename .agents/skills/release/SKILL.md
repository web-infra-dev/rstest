---
name: release
description: 'Release a new version of all rstest packages: bump, release PR, staged npm publish, maintainer approval, merge, and release notes. Use whenever the user wants to release, publish, ship, bump, or cut a new rstest version, asks to "发版", wants to approve staged npm packages, or wants to resume a release that is stuck partway (e.g. CI done but packages not yet approved or PR not yet merged).'
---

# Rstest release workflow

Drive a full rstest release end to end. The flow is **strictly serial** — each
step gates the next, because the tag and release notes must never exist before
users can actually `npm install` the version. Steps marked 🧑 require a human
maintainer; never attempt to perform them yourself.

All deterministic steps are bundled in one Node CLI:

```bash
node .agents/skills/release/scripts/release-tools.mjs <command>
```

(`rt` below abbreviates that invocation; run it from the repo root.) Prefer it
over ad-hoc commands — it encodes verified log formats, the authoritative
public-package list, and non-obvious tricks like bumpp's dry-run behavior.

Track progress: create one task per step below before starting, and keep
statuses current as you go. A release can pause for hours at the approval
step; the task list is what makes the state recoverable.

## Step 0 — Preflight

Run `rt preflight`.

It verifies: gh auth, latest release tag, that all public package versions
are consistent, and that `release.yml` still matches the assumptions in
Step 3. Fix any ❌ before continuing.

A dirty working tree or a local HEAD away from `origin/main` is reported as
⚠️ but does NOT block: the release branch is prepared in an isolated worktree
cut from `origin/main` (Step 2), so the user's in-progress work is never
touched and never leaks into the release.

## Step 1 — Choose the version (🧑 decides)

If the user already gave a bump type or exact version, use it and skip the menu.

Otherwise run `rt bump-menu`. It prints bumpp's own commit list since the
last tag plus its native version menu (`major` / `minor` / `patch` / `next` /
`conventional` / `pre-*` with concrete target versions). The command is
non-mutating (verified: exits 0, no writes).

Show that output to the user **verbatim — do not summarize, regroup, or
truncate it**. The maintainer is about to choose a version number; the full
commit list is the evidence they decide on, and a restructured summary hides
exactly the long tail (refactors, chores) they need to weigh. Add your own
analysis after the raw output, never instead of it. Then ask the user to
choose, with context that helps them judge:

- Default expectation in this repo is **patch** — rstest 0.x patch releases
  routinely contain `feat` commits; minors are reserved for milestones and
  breaking changes. bumpp's `conventional` line will often suggest minor just
  because a feat exists; that is input, not a decision.
- Point out any commits with `!` / `BREAKING CHANGE` markers. Don't rely on
  eyeballing the list for this — run
  `node .agents/skills/create-release-blog/scripts/collect-commits.mjs <last-tag>..HEAD`,
  which buckets breaking commits explicitly.

Do not pick a version yourself when no instruction was given.

## Step 2 — Bump and open the release PR

With the chosen version (e.g. `0.10.4`):

```bash
rt prepare-release-branch patch   # or an exact version like 0.10.4
```

This never touches the current checkout: it creates a temporary git worktree
from `origin/main`, creates `release/0.10.4` there, runs the bump
(`bump.config.mts` makes the commit `release: 0.10.4`, no tag, no push),
verifies the bump commit (only package manifests touched, every public
package included, all on one consistent version — the expected set is derived
from the workspace), and removes the worktree, leaving only the local branch.
A verification failure means a dirty state — stop and investigate.

Then push and open the PR using the commands the tool prints (title format is
load-bearing for repo history):

```bash
git push -u origin release/0.10.4
gh pr create --title "release: 0.10.4" --body "Release 0.10.4" --head release/0.10.4
gh pr checks release/0.10.4 --watch
```

Wait until all checks pass. If CI fails, fix on this branch (or abort the
release) — never trigger the publish workflow on a red branch.

## Step 3 — Trigger the staged npm publish (🧑 confirms)

Ask the user to confirm before dispatching. Staging is reversible (nothing is
public until approval), but it consumes the version number on the registry's
staging area and pings every maintainer, so it should be deliberate.

```bash
gh workflow run release.yml -f npm_tag=latest -f branch=release/0.10.4
```

Two foot-guns, both verified against the workflow definition:

- `npm_tag` **defaults to `alpha`** — a stable release must pass `latest`
  explicitly.
- `branch` must be the release branch, not `main` (the version commit is not
  on main yet; publishing happens before merge by design, so the merge only
  lands once the bits are known good).

Then find and watch the run:

```bash
gh run list --workflow=release.yml --limit 1 --json databaseId,status --jq '.[0]'
gh run watch <run-id> --exit-status
```

Note: the `release_vscode_extension` jobs publish the VS Code extension to the
marketplaces immediately after the npm staging job — marketplace publishing
has no staging step. This is expected.

## Step 4 — Maintainer approves staged packages (🧑 acts)

CI only **staged** the packages: every public package now has a stage-id, and
none of them is installable until a maintainer approves with 2FA. You cannot
do this — 2FA proof-of-presence is the point of the mechanism.

Run `rt extract-stage-ids <run-id>` to get the
`package@version → stage-id` table (it also cross-checks the set against the
workspace's public packages, and prints the npmjs.com fallback link if the
log has no stage lines). Then present the maintainer both options and let
them choose:

**Option A — one command, one OTP (local terminal):**

```
node .agents/skills/release/scripts/release-tools.mjs approve-staged <run-id>
```

(Interactive: prompts for one OTP and loops `npm stage approve` over all
stage-ids. If the OTP window expires mid-loop, re-running is safe.)

**Option B — web UI (Staged Packages tab):**

https://www.npmjs.com/settings/rstest/packages

Do not poll aggressively while waiting; ask the user to tell you when done, or
check back at a relaxed interval.

## Step 5 — Verify every package is live

Run `rt verify-live 0.10.4`.

This uses unauthenticated `npm view`, and staged-but-unapproved versions are
invisible to it — so all-green here is proof the approval actually happened
for **all** packages, not just some. Do not proceed past this gate on a
partial result; a half-approved release plus a published tag is the worst
state (users see release notes for a version they cannot install).

## Step 6 — Merge the release PR

```bash
gh pr merge <pr-number> --squash
```

Squash is this repo's convention; the merge commit becomes
`release: 0.10.4 (#<pr>)` on main, which is what the tag will point at.

## Step 7 — Release notes (🧑 publishes)

Invoke the `create-draft-release-notes` skill with tag `v0.10.4`. It creates
the GitHub draft release (which also creates the tag on the merge commit) and
organizes the generated notes by category.

Hand the draft URL to the user: reviewing, optionally adding highlights, and
clicking publish stay human steps.

## Resuming a partial release

When asked to continue a release, determine the current state in order and
jump to the first incomplete step:

1. `release/x.y.z` branch / PR exists? (`gh pr list --head release/x.y.z`)
2. Publish run dispatched? (`gh run list --workflow=release.yml --limit 3`)
3. Packages live? (`rt verify-live x.y.z`)
4. PR merged? Tag exists? Draft release exists? (`gh release view vx.y.z`)

The serial ordering above is also the recovery invariant: whatever is true of
a later step implies the earlier steps may be assumed done.
