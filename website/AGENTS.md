# Rstest documentation site

This is the documentation website for Rstest, built with [Rspress](https://rspress.rs).

## Structure

- `docs/en/` — English documentation
- `docs/zh/` — Chinese (Simplified) documentation
- `rspress.config.ts` — Rspress configuration

## Commands

```bash
pnpm dev      # Start dev server
pnpm build    # Build for production
pnpm preview  # Preview production build
pnpm gen:release-image  # Generate a release's banner + og image (see below)
```

## Release image generation

Each release blog needs **two** images, generated together so they share one gradient:

- **banner** — `4096x1152`, no tagline, the in-page `<img>` at the top of the post, referenced by its CDN URL (`assets.rspack.rs/rstest/rstest-banner-v<major>-<minor>.png`).
- **og image** — `2400x1260`, optional tagline, the social-share card. `rspress.config.ts` wires `og:image` per blog route: `blog/announcing-<major>-<minor>` → `assets.rspack.rs/rstest/rstest-og-image-v<major>-<minor>.png`.

Both images are committed to [rstackjs/rstack-design-resources](https://github.com/rstackjs/rstack-design-resources) under `rstest/` and served by the `assets.rspack.rs` CDN. Always refer to that repo by its GitHub URL — collaborators keep local clones at different paths.

The templates live **in this repo**; design-resources stays a passive PNG store.

- `scripts/release-image/cli.mts` — entry, parses `--version`/`--description`/`--out-dir`; rolls one background and renders both images
- `scripts/release-image/render.mts` — fetches the Rstest logo SVG → rasterizes → composes with [satori](https://github.com/vercel/satori) → renders with [@resvg/resvg-js](https://github.com/yisibl/resvg-js) at 2x zoom for retina; `randomBackground()` re-rolls the gradient every run (no seed flag)
- `scripts/release-image/template.mts` — [satori-html](https://github.com/natemoo-re/satori-html) template driven by the `LAYOUTS.banner` / `LAYOUTS.og` presets

### Release workflow

1. Run `pnpm gen:release-image --version <ver> [--description "<tagline>"] --out-dir <dir>` from `website/`. The gradient is randomized every run — re-run until both images look good.
2. Compress both PNGs with [TinyPNG](https://tinypng.com) (or Squoosh / ImageOptim / `pngquant`) — the raw resvg output is ~200 KB and palette quantization typically drops it to ~1/4 the size with no visible loss.
3. Commit both images to the design-resources repo under `rstest/` and open a PR — that repo is the only place release images are stored (the generation `--out-dir` is just a local staging spot). After CDN deploy they are reachable at `assets.rspack.rs/rstest/rstest-{banner,og-image}-v<major>-<minor>.png`.

### Do

- Use Space Grotesk (committed under `scripts/release-image/assets/fonts/` with SIL OFL license)
- Render at 2x via `Resvg({ fitTo: { mode: 'zoom', value: 2 } })` so the PNG stays crisp on retina displays
- Fetch the logo from the canonical CDN URL at generation time, not from a committed copy

### Don't

- Don't depend on packages like `geist` that pull in framework peer deps (`next>=13.2`); commit raw `.ttf` files directly instead
- Don't commit release images (banner or og) into this repo; they belong in design-resources
- Don't bake the logo into a static asset; always fetch the SVG so logo updates propagate automatically

## Writing style guidelines

When writing or editing documentation, follow these principles:

### User perspective first

- Every step should explain **what effect it produces**, not just what to do
- Users care about **input → output** and **impact on their project**
- Don't write mechanical step-by-step instructions without context

### Explain tool positioning

- When introducing a new tool/package, first explain:
  - What it is
  - What it can do
  - Why users need it
- Don't just tell users to install something without explaining its purpose
- **When installing multiple packages**, explain each one's role separately — don't assume users know what each package does

### Sniff, Don't Hardcode

- When describing automated behavior (like `rstest init`), emphasize that values are **detected/sniffed** (e.g., test directory, framework, language)
- Don't write as if values are hardcoded

### Show real output

- Use actual command output as examples
- Let users know what they will see when running commands

### Be Concise, not redundant

- Don't list specific generated filenames; say "boilerplate code" instead
- Don't show multiple similar examples (e.g., both native DOM API and Testing Library versions)
- Don't enumerate every detail in dependency lists

### Format conventions

- **Heading case**: Use [sentence-style capitalization](https://learn.microsoft.com/en-us/style-guide/text-formatting/using-type/use-sentence-style-capitalization) for all headings — only capitalize the first word and proper nouns (e.g., `## With factory function` not `## With Factory Function`). Run `npx heading-case` to check.
- npm package names as links: no backticks (e.g., `[@rstest/browser-react](url)` not `[\`@rstest/browser-react\`](url)`)
- First mention of a new package: include GitHub link
- Keep technical terms in English (e.g., Context, Hook, Provider, CI)
- For TypeScript API signatures in docs, prefer `T[]` over `Array<T>`. For unions that allow either a single value or an array, prefer `A | B | (A | B)[]` over `A | B | Array<A | B>`.
- When documenting a newly added API or config option, add an `ApiMeta` version marker near that section. Import it with `import { ApiMeta } from '@components/ApiMeta';` and render it as `<ApiMeta addedVersion="x.y.z" />`. Default `addedVersion` to the owning package's current version with its patch segment incremented by 1 (e.g. `@rstest/core` at `0.10.6` → `<ApiMeta addedVersion="0.10.7" />`).
- If a config option has a corresponding CLI flag, surface it alongside type and default in both EN and ZH, matching the style of neighboring config pages.
- **Punctuation by language**: In `docs/zh/`, use full-width punctuation (`：，。；（）`) for Chinese prose — including the `**类型：**` / `**默认值：**` / `**CLI：**` metadata lines and `**标签**：` bullet lead-ins. Keep half-width only inside code and inline code. In `docs/en/`, use half-width punctuation only. In both languages, keep the metadata colon inside the bold (`**Type:**` / `**类型：**`, not `**Type**:`).

### Logical grouping

- Merge related content (e.g., "sniff project info" + "generate boilerplate")
- Order by cause-and-effect, not arbitrary numbering

## Bilingual maintenance

- Keep English (`docs/en/`) and Chinese (`docs/zh/`) documentation in sync
- Technical terms should remain in English in Chinese docs
- **Translation principle**: When translating between languages, treat the source document as finalized. The target document should faithfully follow the source's content and structure — do not rewrite or "optimize" during translation.
