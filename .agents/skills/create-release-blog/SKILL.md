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
real code samples pulled from the actual PRs — not a finished post. The **Style guidance**
section below defines the voice, wording, and formatting conventions to follow.

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

```mdx
---
description: 'One-line summary used on the blog list and as OG description.'
date: YYYY-MM-DD HH:mm:ss
sidebar: false
---

# Announcing Rstest X.Y

_Month Day, Year_

Rstest X.Y has been released!

Notable changes:

- <Feature one: short noun- or verb-phrase>
- <Feature two: short noun- or verb-phrase>
- <Feature three: short noun- or verb-phrase>
- <Feature four: short noun- or verb-phrase>

## <Feature one heading>

<2–3 short paragraphs that lead with what shipped, then walk through motivation, mechanism,
and trade-offs. Stay factual, no narrative bridges.>

<Code block introduced by a concrete action verb — see Style guidance.>

<Optional follow-up paragraph ending with a uniform docs link — see Style guidance.>

## <Feature two heading>

...

## More improvements

- <Brief descriptive statement> ([#PR](https://github.com/web-infra-dev/rstest/pull/PR))
- <Brief descriptive statement> ([#PR](...))
- <Brief descriptive statement> ([#PR](...))
```

Rules for the title and date line:

- The `# Announcing Rstest X.Y` heading comes **before** the italic `_Month Day, Year_` line.
  Do not put the date above the title.

Rules for the intro:

- Open with a one-line greeting: `Rstest X.Y has been released!`. No narrative buildup, no
  marketing tone, no "We're excited to announce", no through-line sentence summarizing the
  release theme.
- Follow with `Notable changes:` and a bullet list of the chosen highlights. Each bullet
  is a short noun- or verb-phrase naming the feature, wrapped as a markdown link pointing
  to that highlight section's anchor (e.g. `(#threads-pool)`). The entire bullet text is
  the link text — do not link only a fragment.
- Do **not** include PR links, code fences, or extra explanation in the bullets. The only
  link allowed is the in-page anchor — these bullets are a glance-level, clickable table
  of contents, not the article itself.
- Do **not** write a separate narrative paragraph explaining the release theme. The
  bullets _are_ the overview; the section bodies do the explaining.

Rules for the trailing "More improvements" list:

- Single **flat** bullet list — no `### New features` / `### Bug fixes` / `### Performance`
  subheadings.
- Include only `feat` (not selected as highlight), `fix`, and `perf`. Skip `refactor`, `docs`,
  `chore`, `test`, `ci`, and the `other` bucket.
- Order: all `feat` bullets first, then `fix`, then `perf` (preserving the within-bucket order
  from `collect-commits.mjs`).
- **Rewrite each bullet as a brief, descriptive statement in natural language.** Drop the
  `feat(scope):` / `fix(scope):` conventional-commit prefix and reshape the subject so it
  reads as a sentence fragment, not a commit line. Capitalize the first word. Wrap module
  / package / API identifiers in backticks. Keep the PR link at the end.
  - Example: `feat(pool): replace tinypool with self-owned worker pool` →
    ``Replace `tinypool` with a self-owned worker pool``.
  - Example: `fix(browser-react): drop React 17 from peer deps` →
    ``Drop React 17 from `@rstest/browser-react` peer deps``.
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
- **Translate the date line** below the title: `_May 14, 2026_` → `_2026 年 5 月 14 日_`.
- **Translate the intro greeting and bullet preamble**: `Rstest X.Y has been released!` →
  `Rstest X.Y 已经发布！`. `Notable changes:` → `主要变更：`.
- **Translate the "More improvements" bullets too.** After the EN rewrite step they are
  natural-language statements (not commit subjects), so they should be translated rather
  than left in English. Keep PR links identical to EN.
- **Keep technical terms in English** (Rspack, ESM, TypeScript, threads pool, snapshot,
  worker, pool, cache, build, CLI, CI, TTY, artifact, etc.), per the website's `CLAUDE.md`.
  Do **not** translate them to 工作进程 / 池 / 缓存 / 构建 / 制品 / 命令行 / 持续集成 / 终端 / 快照.
- **Keep code samples, frontmatter `date`, table contents, PR links, and `\{#kebab-case}`
  anchor slugs identical to EN** — the slug match is what makes the intro-bullet links work
  across both locales.
- Use **full-width punctuation** in prose (，。：；！？「」（）). Half-width is fine inside
  code, identifiers, and version strings.

### 8. Wire posts into the blog

For each locale, insert the new slug right after `index` in
`website/docs/<lang>/blog/_meta.json`:

```json
["index", "announcing-0-10", ...existing slugs in newest-first order]
```

### 9. Hand off to the user

Report:

- The two file paths created and the chosen highlight PRs.
- Where each code sample came from (PR or docs path) so the user can verify shape.
- A reminder that overview tone, example quality, and link accuracy still need manual polish.

If `/schedule` is appropriate, offer it only when the user has named a concrete release date.

## Style guidance

### Voice and framing

- **Feature-first leads.** Open every highlight section with what shipped: `Rstest X.Y now
supports ...` / `Rstest X.Y adds a new ... flag` / `Rstest X.Y has changed the default of
X from A to B`. Do **not** open with the user's pain (`When you're iterating on a single
file...`), the abstract benefit (`Test runs have a fixed cost...`), or a narrative bridge
  between sections (`The other large fixed cost is...`).
- **No marketing register.** Skip "we're excited", "happy to announce", "huge thanks",
  banner phrases. A factual greeting + bullets is the entire intro.
- **Link, don't restate.** When docs exist for the feature, link to them rather than
  copying explanations into the blog.
- **Show real code.** A small, runnable snippet beats a paragraph describing it. Pull every
  snippet from the PR, tests, or existing docs — never invent API shapes.

### Wording and expression (EN)

- **Subject is the product.** `Rstest now supports X.` / `Rstest has changed X to Y.` Use
  `You can ...` sparingly for user-action sentences; never use `We added ...`.
- **Plain, declarative sentences.** Break up em-dash chains; prefer two short sentences over
  one sentence with three parenthetical clauses. If a sentence has more than one em-dash,
  it's almost always rewritable.
- **No informal asides.** No parenthetical jokes, no scare-quoted phrases ("what I'm
  working on right now"), no `feels slow` / `kind of wasteful`. Stay factual.
- **Lead code blocks with a concrete action verb.** `To enable it, set ...:` / `You can
enable it explicitly:` / `Configure as follows:`. Not `Here's an example:` or `Like so:`.
- **Uniform section-closing reference link.** End each highlight section with a docs link
  in one of these forms:
  - `Please refer to [Page name](/path) to learn more.` — when linking to a full docs page.
  - `... please refer to the [Section name](/path#anchor) section.` — when linking to a
    specific section, typically appended to a sentence that lists what the section covers.
    Do not use `See X for details`, `More at X`, or `Full behavior in X`.
- **Cause-and-effect for opt-outs.** `If you do not need this feature, you can set X to Y to
disable it.` — direct, no hedging.
- **Concrete numbers, not vague comparisons.** `About 10× faster` / `approximately halves
the build phase` / `from 8 s to 0.1 s`. Not `much faster` / `significantly improved`.

### Wording and expression (ZH)

Mirror the EN voice using these ZH conventions:

- **Subject-led leads**: 「Rstest X.Y 现已支持 ...」/「Rstest X.Y 新增了 ...」/「Rstest X.Y
  已将 X 调整为 Y」. Do not start with「当你 X 时」narrative bridges.
- **Uniform section closing**: 「请参考 [Page name](/path) 了解更多。」
- **Code-block intro**: 「要使用 X，将 Y 设置为 Z：」/「可以显式开启：」/「如下：」.
- **Cause-and-effect**: 「如果你不需要此功能，可以将 X 设置为 Y 来禁用。」
- **Preferred connectives**: 此时 / 由于 / 对于 / 无需 / 通过 / 得益于 / 受益于 / 现已 / 透传 / 即。
- Avoid stacking 「——」破折号；用句号断句。Avoid 「我们」 first-person framing.
- **The date line** uses the form `_2026 年 5 月 14 日_` (use 年/月/日, no leading zero, half-width space between numerals).

### Formatting

- **Heading case (EN)**: sentence-style (`## A new threads pool`, not `## A New Threads
Pool`), per the website's `CLAUDE.md`. Run `npx heading-case` to check.
- **Section anchors**: every highlight heading takes an explicit `\{#kebab-case}` anchor
  (e.g. `## A new threads pool \{#threads-pool}`). EN and ZH **must share the same anchor
  slug** so the intro-bullet links resolve in both locales and cross-locale deep links
  work. Pick slugs short enough to read in URLs (`#threads-pool`, not `#a-new-threads-pool`).
- **Code-block titles**: when a snippet maps to a real file path (`rstest.config.ts`,
  `package.json`, etc.), set `title="<path>"` on the fence so the rendered header shows it.
- **First mention of a non-core package** uses the GitHub-link form
  `[@rstest/adapter-rslib](https://github.com/web-infra-dev/rstest/tree/main/packages/adapter-rslib)`,
  per `website/CLAUDE.md`. No backticks around the npm name in links.
- **Frontmatter date**: use the release date if the user supplies one; otherwise leave a
  clear `TODO: release date` so it isn't silently wrong. Do **not** set it to the current
  timestamp.

## Don'ts

- Don't dump commit subjects into highlight sections — those sections are prose.
- Don't describe features that aren't actually in the commit range.

## Resources

- `scripts/resolve-range-start.mjs`: given a next version, compute `sameTier` and
  `latest` predecessor tags (used to prompt the user for the range start).
- `scripts/collect-commits.mjs`: bucket commits in a git range by conventional-commit type.
- `website/docs/en/blog/`, `website/docs/zh/blog/`: target output directories.
- Sibling skill: `create-draft-release-notes` (commit-dump GitHub release; complementary, not a replacement).
