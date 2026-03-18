---
name: pr
description: 'Create a PR for the current branch. Use when the user expresses intent to open, submit, or prepare a pull request, regardless of exact phrasing or language.'
metadata:
  internal: true
---

# Create Pull Request

## Branch Strategy

- **Target branch**: `main`
- Never PR directly from `main` — always use a topic branch (`<type>/<short-description>`).
- If currently on `main` with local changes (staged, unstaged, or committed-but-unpushed), create a new topic branch (moving the commits if needed), commit any uncommitted work, and proceed.
- Commit messages must follow Conventional Commits: `type(scope): description`.
- Check if a PR already exists for the current branch (`gh pr list`) before creating to avoid duplicates.
- _Note_: Invoking this skill grants explicit permission to push to the remote repository.

## PR Validation

Use `.github/workflows/` as the source of truth for validation commands. Run the full validation suite locally before pushing. Invoking this skill grants explicit permission to run full build and test suites.

Run `pnpm format` first to ensure consistent formatting, then stage any resulting changes before proceeding.

1. `pnpm run lint`
2. `pnpm run typecheck`
3. `pnpm run build`
4. `pnpm run test`
5. `cd e2e && pnpm test`

If any step fails, fix the issue and re-run. If a step cannot run locally (e.g. environment restrictions), skip it and note the skipped validation in the PR body. If validation cannot be completed, create a **Draft PR** (`gh pr create --draft`).

## Create PR

### Push

- Ensure the branch is pushed to `origin` before creating the PR.
- _Never_ use `--force` without explicit user approval.

### Issue Linking

- **Use session context first.** Extract the issue number from the conversation history — do NOT run a blind `gh issue list` search.
- If the session context contains an explicit issue number, use it directly (e.g., `Fixes #123`).
- Include `Related Links` only when there is a useful issue, documentation page, design discussion, or other relevant reference; otherwise omit the section entirely.
- **Fallback only**: If genuinely uncertain and the user asks to find one, use `gh issue list -S "<keywords>" --limit 5` with precise keywords.

### Title

- If the branch has only one commit, use its commit message as the PR title.
- Otherwise, use `type(scope): description` — Conventional Commits format, no emoji.

### Body

Use the `.github/PULL_REQUEST_TEMPLATE.md` structure. Use HEREDOC (`gh pr create --body "$(cat <<'EOF' ... EOF)"`) for multi-line formatting. **All PR content must be in English.**

#### Summary — Strict Rules

Follow these rules with zero exceptions:

1. **Structure**: Use exactly these three subsections (omit User Impact only if purely internal):
   - `### Background` <1–2 sentences: what problem exists and why it matters>
   - `### Implementation` <1–3 bullets or a short numbered list: what was changed and how>
   - `### User Impact` <1 sentence: what changes for the end user, or "None — internal refactor">
   - Render each subsection as a Markdown level-3 heading with no trailing colon.
   - Put a blank line between each subsection so the Summary reads as three clearly separated blocks.
   - When listing multiple implementation changes, use bullets or numbering instead of packing clauses with semicolons.

2. **Brevity**: The entire Summary MUST fit within 15 lines (excluding diagrams). Every sentence must carry information that a reviewer cannot get from the diff itself. Do NOT:
   - Repeat the PR title or list every file changed.
   - Use filler phrases ("This PR introduces...", "In order to improve...").

3. **ASCII Diagrams**: If and only if the change involves architectural changes, data flow changes, or non-trivial process/state transitions, include a plaintext ASCII diagram inside a fenced code block (keep under 20 lines). Do NOT use for trivial bug fixes.

4. **Self-check**: Before submitting, re-read and delete any sentence that a reviewer would skip.

#### Output

Output the PR URL to the user when done. If created as a draft, tell the user what remains to be verified.
