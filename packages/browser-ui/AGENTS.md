# @rstest/browser-ui

Prebuilt browser container UI for Rstest's browser mode testing.

## Tech stack

- React 19
- Tailwind CSS v4
- Ant Design v6
- Lucide React icons
- birpc for RPC communication

## Role and contracts

This package owns transport bridging and UI state projection only — host scheduling and protocol semantics belong to `@rstest/browser` (boundary map: `packages/browser/AGENTS.md`).

- `src/core/channel.ts` is the validation boundary for messages forwarded between the runner iframe and the host.
- `src/core/treeNodeKey.ts` is the single owner of the test-tree node-key grammar — never re-encode it elsewhere (the byte-for-byte producer/consumer contract is documented in its header).

## Commands

```bash
pnpm --filter @rstest/browser-ui dev      # Start dev server
pnpm --filter @rstest/browser-ui build    # Build for production
pnpm --filter @rstest/browser-ui lint     # Rslint
```

## Do

- Use Tailwind utility classes for styling
- Use Ant Design components for complex UI (Tree, etc.)
- Use Lucide React for icons
- Resolve Ant Design styling conflicts via `ConfigProvider` theme tokens (prefer seed tokens over low-level tokens)
- Follow the [Vercel Geist design system](https://vercel.com/geist) for colors and spacing — use Geist CSS variables (`var(--ds-*)`, `var(--accents-*)`, etc.) instead of hard-coded colors
- Treat `data-testid` attributes as public API — add them to every interactive surface (buttons, inputs, tabs, tree rows, etc.); use `data-test-*` for dynamic identifiers; skip decorative elements

## Don't

- Don't use inline styles; prefer Tailwind classes
- Don't install additional UI libraries without discussion
- Don't hard-code colors; use Geist CSS variables
- Don't create class-based components; use functional components with hooks
- Don't use `!important` or the Tailwind `!` modifier unless explicitly approved
- Don't use Ant Design `Typography` (including `Typography.Text`); use semantic HTML elements with Tailwind
