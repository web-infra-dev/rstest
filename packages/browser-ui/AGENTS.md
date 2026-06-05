# @rstest/browser-ui

Prebuilt browser container UI for Rstest's browser mode testing.

## Tech stack

- React 19
- Tailwind CSS v4
- Ant Design v5
- Lucide React icons
- birpc for RPC communication

## Module structure

- `src/main.tsx` — Application entry
- `src/core/channel.ts` — Container message channel (`__rstest_dispatch__`) and dispatch RPC forwarding
- `src/core/runtime.ts` — Runtime URL helpers (`runner`/`websocket`)
- `src/components/` — UI components
- `src/hooks/` — React hooks (notably `useRpc` WebSocket + birpc lifecycle)
- `src/utils/` — Utility functions and constants
- `src/types.ts` — TypeScript type definitions

## Commands

```bash
pnpm --filter @rstest/browser-ui dev      # Start dev server
pnpm --filter @rstest/browser-ui build    # Build for production
pnpm --filter @rstest/browser-ui typecheck
```

## Do

- Use Tailwind utility classes for styling
- Use Ant Design components for complex UI (Tree, etc.)
- Use Lucide React for icons
- Keep components small and focused
- Use functional components with hooks
- Target modern browsers only (no IE)
- Resolve Ant Design styling conflicts via `ConfigProvider` theme tokens (prefer seed tokens over low-level tokens)
- Follow the [Vercel Geist design system](https://vercel.com/geist) for colors and spacing — use Geist CSS variables (`var(--ds-*)`, `var(--accents-*)`, etc.) instead of hard-coded colors
- Do not use `!important` or Tailwind `!` modifier unless explicitly approved
- Treat `data-testid` attributes as public API — add them to every interactive surface (buttons, inputs, tabs, tree rows, etc.); use `data-test-*` for dynamic identifiers; skip decorative elements

## Don't

- Don't use inline styles; prefer Tailwind classes
- Don't install additional UI libraries without discussion
- Don't hard-code colors; use Geist CSS variables
- Don't create class-based components
- Don't use Ant Design `Typography` (including `Typography.Text`); use semantic HTML elements with Tailwind

## Key files

- `src/main.tsx` — App entry and root component
- `src/core/channel.ts` — Dispatch channel forwarding and validation boundary
- `src/components/TestFilesTree.tsx` — Main test file tree component
- `src/hooks/useRpc.ts` — RPC communication hook
- `tailwind.config.cjs` — Tailwind configuration
- `rsbuild.config.ts` — Rsbuild build configuration

## Component patterns

- Tree rendering: `src/components/TestFilesTree.tsx`
- Resizable panels: `src/components/Resizable.tsx`
- Status display: `src/components/StatsBar.tsx`
- Header patterns: `src/components/SidebarHeader.tsx`
