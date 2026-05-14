---
name: create-release-blog
description: 'Generate a narrative version release blog post from commits within a tag range. Use when the user wants to draft an article-style release blog (overview + a few feature highlights + a short list of minor changes), not a commit-dump release note. Asks the user to multi-select which features to highlight, then writes a bilingual draft under website/docs/{en,zh}/blog/.'
metadata:
  internal: true
---

# Create Release Blog

## Overview

Draft a bilingual release blog post under `website/docs/{en,zh}/blog/` for a given version
range. The post is an **article**, not a changelog: an opening overview, a few in-depth
highlight sections, then a compact list of minor `feat`/`fix`/`perf` entries.

The user will polish the draft manually. Aim for a strong starting point — readable prose,
real code samples pulled from the actual PRs — not a finished post. Reference style:
[Astro 6.3.0 blog](https://astro.build/blog/astro-630/).

This is **not** a GitHub release-note generator. For that, use the `create-draft-release-notes`
skill. Release notes enumerate every commit; release blogs select 3–5 features and tell a
story about them.

## Workflow

### 1. Resolve the version range

Accept these input shapes:

- `previous_tag..next_tag` — explicit two-sided range. Use as-is; **skip the
  range-start prompt** below.
- `next_version` (e.g. `0.10.0`) — resolve the range start via the prompt below;
  the end is `HEAD`.
- No input — ask the user for the next version first (with `gh release list --limit 5`
  as context), then run the prompt below.

The filename is `announcing-<major>-<minor>.mdx` (e.g. `0.10.0` → `announcing-0-10.mdx`).

#### Prompt for the range start

Run the resolver to compute candidate predecessors:

```bash
node .agents/skills/create-release-blog/scripts/resolve-range-start.mjs <next-version>
```

It prints JSON like:

```json
{
  "nextVersion": "0.10.0",
  "bump": "minor",
  "sameTier": "v0.9.0",
  "latest": "v0.9.10",
  "sameTierEqualsLatest": false,
  "tagPrefix": "v"
}
```

`sameTier` is the predecessor in the same bumped tier (previous minor's `.0`,
previous patch, or last tag of the previous major). `latest` is the most recent
tag below `nextVersion`.

Use `AskUserQuestion` to pick the range start:

- If `sameTierEqualsLatest` is `false` and both are non-null, offer **two** options:
  1. `<sameTier>` — labeled e.g. "Previous minor (v0.9.0)" with a description
     explaining "same biggest-version-tier predecessor; covers the full minor cycle".
  2. `<latest>` — labeled e.g. "Latest release (v0.9.10)" with a description
     "most recent published tag; covers only commits since that patch".
- If `sameTierEqualsLatest` is `true`, offer **one** option (`<latest>`) and rely on
  the auto-added "Other" entry for a custom tag.
- If either candidate is `null`, present whichever is non-null plus "Other".

The user picks one option, picks "Other" to type a custom tag, or types one inline.

The resolved range is `<chosen-start>..<next-end>` where `<next-end>` is `HEAD` (or
the user's explicit end tag). **The start tag is excluded from the search** — `git`'s
`A..B` syntax yields commits reachable from `B` but not from `A`, so commits _on_ the
start tag itself are not included.

State the resolved range and the target filename before continuing.

### 2. Collect and bucket commits

Run the helper:

```bash
node .agents/skills/create-release-blog/scripts/collect-commits.mjs <previous_tag>..<next_tag>
```

It prints JSON with `breaking`, `feat`, `fix`, `perf`, `refactor`, `docs`, `other`. Each entry
has `sha`, `type`, `scope`, `subject`, `prNumber`, `raw`. Save the output to a temp file so
later steps can re-read it.

### 3. Order highlight candidates

Sort entries in the `breaking` + `feat` buckets so the most blog-worthy ones appear first when
you present them. This is **ordering, not pruning** — all candidates are still presented to
the user in the next step.

- `breaking` entries come first and are pre-recommended as defaults — breaking changes almost
  always warrant a highlight section.
- Within `feat`, rank by user-facing significance:
  - **Scope priority**: `core` > `browser`/`browser-react`/`coverage-istanbul` >
    `adapter-*`/`vscode` > internal/tooling scopes.
  - **PR weight** (signal of size): `gh pr view <N> --json additions,deletions,files`; bigger
    user-facing diffs outrank tiny ones. Discount lockfiles, generated code, and fixture-only
    diffs.
  - **Docs touched**: PRs that modified `website/docs/**` are user-facing — bump them up.
  - **Subject keywords**: subjects with "support", "add", "new" beat "tweak", "improve",
    "expose".

### 4. Summarize every candidate and ask the user to pick

The person running this skill may not have written each PR. They need a plain-language summary
to choose well. **Read each candidate PR before listing them** — do not paste raw commit
subjects.

For every candidate, fetch the PR:

```bash
gh pr view <PR> --json title,body,files,labels
```

Then write **one sentence** of user-side value per candidate:

- Plain language for a Rstest user, not a Rstest contributor. They know the test framework's
  surface — `describe`, `expect`, `--watch` — not the internals — `pool`, `dispatchRouter`,
  `WorkerState`.
- **Lead with the user-visible benefit, not the implementation.** Good: "Run only the tests
  affected by your uncommitted changes for faster local iteration." Bad: "Add a `--changed`
  flag wired through the module graph resolver."
- Drop framework-internal jargon (`taskContext`, `birpc`, `dispatch namespace`) unless the
  feature is itself about that internal — and even then, gloss it ("the worker-to-host
  channel").
- If the PR body has a clear motivation paragraph, paraphrase it. If the PR body is thin
  (one-liner, just a checklist), infer the user impact from the `files` field and the related
  docs path, and say so explicitly: "PR body was thin; summary inferred from changed files."

Present **all** candidates as a numbered markdown list — do not use `AskUserQuestion`, which
caps at 4 options per question and is too narrow for this step. Format:

```text
1. **`feat(core): subject`** ([#1234](https://github.com/web-infra-dev/rstest/pull/1234))
   <one-sentence plain-language user-value summary>

2. **`feat(browser): subject`** ([#1235](https://github.com/web-infra-dev/rstest/pull/1235))
   <summary>

...
```

End with: "Reply with the numbers you'd like to highlight (e.g. `1,3,5`). 2–4 is the
sweet spot — fewer reads thin, more dilutes the article." Wait for the user's reply before
continuing.

### 5. Gather code-sample context for each chosen highlight

The PR body was already loaded in step 4. For each _selected_ highlight, additionally:

```bash
gh pr diff <PR> | head -300        # see the API surface
```

Then:

- Look for a related docs page in `website/docs/en/`; if present, link to it from the
  highlight section instead of restating the docs.
- Extract a small (5–15 line) code sample that shows the new surface. Prefer real code from
  PR-added tests, examples, or docs. **Do not invent API shapes** — if the PR diff doesn't
  show usage, search the test fixtures or website docs for an example.

### 6. Write the EN post

Path: `website/docs/en/blog/announcing-<major>-<minor>.mdx`. Structure:

````mdx
---
description: 'One-line summary used on the blog list and as OG description.'
date: YYYY-MM-DD HH:mm:ss
sidebar: false
---

_Month Day, Year_

# Announcing Rstest X.Y

<Intro: 1–3 paragraphs that double as the highlights overview. Open with the release
through-line (one sentence), then walk through each highlight feature by name in prose — the
intro itself enumerates the highlights, so there is **no separate `## Highlights` bullet list**.>

## <Feature one heading> \{#feature-one}

<2–4 paragraphs: motivation → what it does → tradeoffs/limits.>

```ts
// real code sample lifted from the PR or docs
```
````

<Optional follow-up paragraph; link to docs if they exist.>

## <Feature two heading> \{#feature-two}

...

## More improvements

- `feat(scope):` subject ([#PR](https://github.com/web-infra-dev/rstest/pull/PR))
- `feat:` subject ([#PR](...))
- `fix(scope):` subject ([#PR](...))
- `perf:` subject ([#PR](...))

````

Rules for the intro:

- **The intro is the highlights overview.** Mention each highlight feature by name in flowing
  prose. Do **not** add a separate `## Highlights` bullet-list section.
- Lead with one sentence stating the through-line of the release ("Rstest X.Y is a release
  about iteration speed."). The subsequent sentences walk through the highlight features.
- It's fine to inline-link a highlight name to its anchor on first mention (e.g.,
  `[\`--changed\`](#run-changed-tests)`), but keep prose readable — don't bullet-ify it.

Rules for the trailing "More improvements" list:

- Single **flat** bullet list — no `### New features` / `### Bug fixes` / `### Performance`
  subheadings.
- Include only `feat` (not selected as highlight), `fix`, and `perf`. Skip `refactor`, `docs`,
  `chore`, `test`, `ci`, and the `other` bucket.
- Order: all `feat` bullets first, then `fix`, then `perf` (preserving the within-bucket order
  from `collect-commits.mjs`).
- Keep each bullet to one line: `` `feat(scope):` subject ([#PR](url)) ``. Do not rewrite the
  subject.
- Omit the entire section if all three buckets are empty.

**Do not add an Acknowledgements / "Thanks to contributors" section.** The post ends after
"More improvements". A changelog link belongs in a highlight or trailing bullet, not its own
section.

### 7. Write the ZH post

Path: `website/docs/zh/blog/announcing-<major>-<minor>.mdx`. Mirror the EN structure exactly.

- Translate **every** heading and prose paragraph. Headings that must be translated include:
  - `# Announcing Rstest X.Y` → `# Rstest X.Y 发布`
  - Each `##` highlight section heading.
  - `## More improvements` → `## 其他改进` (do not leave it in English).
- **Keep technical terms in English** (Rspack, ESM, TypeScript, threads pool, snapshot, etc.),
  per the website's `CLAUDE.md`.
- **Keep code samples, anchors, conventional-commit prefixes, and PR links identical to EN.**
- Keep the trailing bullets under `## 其他改进` verbatim — they are commit subjects authored
  in English; do not translate.
- Keep the anchor `\{#...}` identical to EN so cross-locale links match.

### 8. Wire posts into the blog

For each locale, insert the new slug right after `index` in
`website/docs/<lang>/blog/_meta.json`:

```json
["index", "announcing-0-10", ...existing slugs in newest-first order]
````

### 9. Hand off to the user

Report:

- The two file paths created and the chosen highlight PRs.
- Where each code sample came from (PR or docs path) so the user can verify shape.
- A reminder that overview tone, example quality, and link accuracy still need manual polish.

If `/schedule` is appropriate, offer it only when the user has named a concrete release date.

## Style guidance

- **Open with the user, not the team.** "Rstest 0.10 makes …" beats "We're excited to
  announce 0.10". Skip thanks — the post has no Acknowledgements section.
- **Show real code in highlights.** A small, runnable snippet beats a paragraph describing it.
- **Link, don't restate.** When docs exist, link to them rather than copying explanations.
- **Heading case**: sentence-style (`## With factory function`, not Title Case), per the
  website's `CLAUDE.md`.
- **Anchors**: explicit `\{#kebab-case}` on every highlight heading so the intro prose can
  inline-link to them. Use the same anchor in both EN and ZH posts.
- **Frontmatter date**: use the release date if the user supplies one; otherwise leave a clear
  `TODO: release date` so it isn't silently wrong.

## Don'ts

- Don't dump commit subjects into highlight sections — those sections are prose.
- Don't include `refactor` / `chore` / `docs` / `test` / `ci` in "More improvements".
- Don't describe features that aren't actually in the commit range.
- Don't translate technical terms or code samples in the ZH post.
- Don't invent API shapes — pull every code sample from the PR, tests, or existing docs.
- Don't set `date` to the current timestamp unless the user confirmed the release time.

## Resources

- `scripts/resolve-range-start.mjs`: given a next version, compute `sameTier` and
  `latest` predecessor tags (used to prompt the user for the range start).
- `scripts/collect-commits.mjs`: bucket commits in a git range by conventional-commit type.
- `website/docs/en/blog/`, `website/docs/zh/blog/`: target output directories.
- Reference style: <https://astro.build/blog/astro-630/>.
- Sibling skill: `create-draft-release-notes` (commit-dump GitHub release; complementary, not a replacement).
