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
highlight sections, then a single closing sentence linking to the GitHub release page.

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
has `sha`, `type`, `scope`, `subject`, `prNumber`, `raw`. Step 3 reads the `breaking` and
`feat` buckets; the other buckets are produced for completeness but unused by this flow.

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

**Read each candidate PR before listing them** — do not paste raw commit subjects. For every
candidate, fetch the PR:

```bash
gh pr view <PR> --json title,body,files,labels
```

Then write **one sentence** of user-side value per candidate:

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
authors:
  - name: <github-handle>
    avatar: 'https://github.com/<github-handle>.png'
---

_Month Day, Year_

# Announcing Rstest X.Y

<img
  src="https://assets.rspack.rs/rstest/rstest-banner-vX-Y.png"
  alt="Rstest X.Y"
  style={{
    boxShadow: '0 2px 6px rgba(0, 0, 0, 0.08)',
  }}
/>

Rstest X.Y has been released.

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

---

For a full list of changes, see the [vX.Y.Z release notes](https://github.com/web-infra-dev/rstest/releases/tag/vX.Y.Z).
```

Rules for frontmatter `authors`:

- List the people who drafted **this specific post**, not the maintainer set. Without
  `authors`, the blog list shows the generic `Rstest Team`.
- Ask the user who should be credited and in what order; do **not** infer from `git log`
  or PR authorship.
- Each entry takes `name` (GitHub handle) and `avatar` (`https://github.com/<handle>.png`).
  Keep the order identical between EN and ZH frontmatter.

Rules for the banner image:

- Insert the banner **between** the H1 and the greeting. Use `<img>` JSX (not markdown
  `![alt](url)`) so it can carry an inline `boxShadow` — the shadow separates the lower
  edge from a white page background in light mode.
- Do **not** set `width` / `aspectRatio` / `objectFit`. The banner is designed at its
  intended on-page size; extra constraints crop or shrink the artwork.
- Asset URL: `https://assets.rspack.rs/rstest/rstest-banner-v<major>-<minor>.png` (no
  patch segment; blog posts are per-minor). Banners ship via PR against
  [rstackjs/rstack-design-resources](https://github.com/rstackjs/rstack-design-resources).
- Inline style: `{{ boxShadow: '0 2px 6px rgba(0, 0, 0, 0.08)' }}`. No border, no
  border-radius.

Rules for the OG image:

- The OG card is a **separate** asset from the banner: `rstest-og-image-v<major>-<minor>.png`
  (2400×1260, 1.91:1 social-share aspect). Do not point `og:image` at the banner — a wide
  strip renders poorly as a Twitter/Slack card.
- Per-post override lives in `website/rspress.config.ts` via the top-level `head` function
  (route-aware). Frontmatter `head` does **not** override the site-wide default reliably:
  rspress doesn't dedupe `og:image`, so two tags end up in the HTML and scrapers pick the
  first.
- Confirm the OG asset resolves before publish (`curl -I`).

Rules for the intro:

- Open with a one-line greeting: `Rstest X.Y has been released.` — period, not exclamation;
  factual, not celebratory. (See Style guidance for the broader tone rules.)
- Follow with `Notable changes:` and a bullet list of the chosen highlights. Each bullet
  is a short noun- or verb-phrase naming the feature, wrapped as a markdown link to that
  section's `\{#kebab-case}` anchor. The entire bullet is the link text — do not link only
  a fragment.
- Bullets carry **no** PR links, code fences, or extra prose, and **no** narrative
  paragraph follows them. The bullets _are_ the overview; the section bodies do the
  explaining.

Rules for the closing release-notes link:

- Close the post with a **single sentence** linking to the GitHub release page for this
  version. No `## More improvements` heading, no per-PR bullet list — the release page
  already enumerates everything.
- Template: `For a full list of changes, see the [vX.Y.Z release notes](https://github.com/web-infra-dev/rstest/releases/tag/vX.Y.Z).`
  The URL must use the `v`-prefixed tag (`v0.10.0`, not `0.10.0`).
- Place it as the **last** paragraph of the post, immediately after the last highlight
  section. Do **not** wrap it in a heading.
- Separate it from the preceding section with a markdown horizontal rule (`---` on its
  own line, blank lines above and below) — it's a meta-pointer, not a continuation.

**Do not add an Acknowledgements / "Thanks to contributors" section.** The post ends with
the release-notes link. Contributors are surfaced on the release page itself.

### 7. Write the ZH post

Path: `website/docs/zh/blog/announcing-<major>-<minor>.mdx`. Mirror the EN structure exactly.

- Translate **every** heading and prose paragraph. Headings that must be translated include:
  - `# Announcing Rstest X.Y` → `# Rstest X.Y 发布`
  - Each `##` highlight section heading.
- **Translate the date line** above the title: `_May 14, 2026_` → `_2026 年 5 月 14 日_`.
- **Translate the intro greeting and bullet preamble**: `Rstest X.Y has been released.` →
  `Rstest X.Y 已经发布。` (full-width period, no exclamation). `Notable changes:` →
  `主要变更：`.
- **Translate the closing release-notes sentence** but keep the URL identical:
  `For a full list of changes, see the [vX.Y.Z release notes](URL).` →
  `完整变更请参考 [vX.Y.Z release notes](URL)。`. Keep the link text in English (it
  reads as a proper noun referring to the GitHub page).
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
- **Show real code.** A small, runnable snippet beats a paragraph describing it. (See
  step 5 for sourcing — never invent API shapes.)

### Wording and expression (EN)

- **Subject is the product, not the team.** Never use `We added ...`. Use `You can ...`
  sparingly for user-action sentences.
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

## Resources

- `scripts/resolve-range-start.mjs`: given a next version, compute `sameTier` and
  `latest` predecessor tags (used to prompt the user for the range start).
- `scripts/collect-commits.mjs`: bucket commits in a git range by conventional-commit type.
- `website/docs/en/blog/`, `website/docs/zh/blog/`: target output directories.
- Sibling skill: `create-draft-release-notes` (commit-dump GitHub release; complementary, not a replacement).
