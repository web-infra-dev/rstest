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
- `src/components/` — UI components
- `src/hooks/` — React hooks (e.g., `useRpc`)
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
- Use `clsx` for conditional class names
- Use Ant Design components for complex UI (Tree, etc.)
- Use Lucide React for icons
- Keep components small and focused
- Use functional components with hooks

## Don't

- Don't use inline styles; prefer Tailwind classes
- Don't install additional UI libraries without discussion
- Don't hard-code colors; use Tailwind theme
- Don't create class-based components

## Key files

- `src/main.tsx` — App entry and root component
- `src/components/TestFilesTree.tsx` — Main test file tree component
- `src/hooks/useRpc.ts` — RPC communication hook
- `tailwind.config.cjs` — Tailwind configuration
- `rsbuild.config.ts` — Rsbuild build configuration

## Component patterns

- Tree rendering: `src/components/TestFilesTree.tsx`
- Resizable panels: `src/components/Resizable.tsx`
- Status display: `src/components/StatsBar.tsx`
- Header patterns: `src/components/SidebarHeader.tsx`

## Safety

Allowed: read files, typecheck, run dev server

Ask first: add dependencies, modify Tailwind config, change build config

## When stuck

Ask a clarifying question or propose a plan before making large changes.
