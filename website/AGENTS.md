# Rstest documentation site

This is the documentation website for Rstest, built with [Rspress](https://rspress.dev).

## Structure

- `docs/en/` — English documentation
- `docs/zh/` — Chinese (Simplified) documentation
- `rspress.config.ts` — Rspress configuration

## Commands

```bash
pnpm dev      # Start dev server
pnpm build    # Build for production
pnpm preview  # Preview production build
pnpm gen:og   # Generate a release Open Graph image (see below)
```

## Open Graph image generation

Per-release og images live in [rstackjs/rstack-design-resources](https://github.com/rstackjs/rstack-design-resources) and are served by the `assets.rspack.rs` CDN. The template lives **in this repo** to keep design-resources as a passive PNG store.

- `scripts/og-image/cli.mts` — entry, parses `--version`/`--description`/`--out`
- `scripts/og-image/render.mts` — fetches the Rstest logo SVG → rasterizes → composes with [satori](https://github.com/vercel/satori) → renders with [@resvg/resvg-js](https://github.com/yisibl/resvg-js) at 2x zoom for retina
- `scripts/og-image/template.mts` — [satori-html](https://github.com/natemoo-re/satori-html) template, modeled after the `Rsbuild og image 1.0` artboard in design-resources

### Release workflow

1. Run `pnpm gen:og --version <ver> --description "<tagline>"` from `website/`. Use `--out` to write directly into a local clone of the design-resources repo at `rstest/assets/rstest-og-image-v{version-with-hyphens}.png` (e.g. `v0-5.png`).
2. Commit the PNG in the design-resources repo and open a PR — that repo is the only place release PNGs are stored.
3. After CDN deploy, the PNG is reachable at `assets.rspack.rs/rstest/assets/rstest-og-image-v0-5.png`. Wiring it up per blog `routePath` in `rspress.config.ts` is a separate follow-up — the site currently sets a single static `og:image` via `pluginOpenGraph`.

### Do

- Use Space Grotesk (committed under `scripts/og-image/assets/fonts/` with SIL OFL license)
- Render at 2x via `Resvg({ fitTo: { mode: 'zoom', value: 2 } })` so the PNG stays crisp on retina displays
- Before committing the PNG to design-resources, run it through [TinyPNG](https://tinypng.com) (or Squoosh / ImageOptim / `pngquant`) — the raw resvg output is ~500 KB, palette quantization drops it to ~140 KB with no visible loss
- Fetch the logo from the canonical CDN URL at generation time, not from a committed copy

### Don't

- Don't depend on packages like `geist` that pull in framework peer deps (`next>=13.2`); commit raw `.ttf` files directly instead
- Don't write generated PNGs into this repo; they belong in design-resources
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
- When documenting a newly added API or config option, add an `ApiMeta` version marker near that section. Import it with `import { ApiMeta } from '@components/ApiMeta';` and render it as `<ApiMeta addedVersion="x.y.z" />`.

### Logical grouping

- Merge related content (e.g., "sniff project info" + "generate boilerplate")
- Order by cause-and-effect, not arbitrary numbering

## Bilingual maintenance

- Keep English (`docs/en/`) and Chinese (`docs/zh/`) documentation in sync
- Technical terms should remain in English in Chinese docs
- **Translation principle**: When translating between languages, treat the source document as finalized. The target document should faithfully follow the source's content and structure — do not rewrite or "optimize" during translation.
