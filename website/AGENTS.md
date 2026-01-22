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
```

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

- npm package names as links: no backticks (e.g., `[@rstest/browser-react](url)` not `[\`@rstest/browser-react\`](url)`)
- First mention of a new package: include GitHub link
- Keep technical terms in English (e.g., Context, Hook, Provider, CI)

### Logical grouping

- Merge related content (e.g., "sniff project info" + "generate boilerplate")
- Order by cause-and-effect, not arbitrary numbering

## Bilingual maintenance

- Keep English (`docs/en/`) and Chinese (`docs/zh/`) documentation in sync
- Technical terms should remain in English in Chinese docs
- **Translation principle**: When translating between languages, treat the source document as finalized. The target document should faithfully follow the source's content and structure — do not rewrite or "optimize" during translation.
