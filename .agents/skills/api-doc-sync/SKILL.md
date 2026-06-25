---
name: api-doc-sync
description: Verify hand-written API doc signatures match the exported types. Use after changing a public type in packages/core/src/types/, editing a `**Type:**`/`**类型：**` block in website/docs, or reviewing signature drift.
metadata:
  internal: true
---

# API Doc Signature Sync

The `**Type:**` / `**类型：**` blocks in `website/docs/{en,zh}/api/**` are
**hand-written, curated copies** of real exported types — there is no
generation and no compiler check behind them, so they can be wrong the moment
they are authored, not only when the type later changes. This skill catches
both: it grounds every documented signature in the actual source type and the
`tsc` oracle instead of trusting the prose.

> **Core rule — verify, never recall.** Read the type from
> `packages/core/src/types/*.ts` (and, when built, the emitted `.d.ts`) and let
> `tsc` decide. Never judge a signature from memory or from the doc's own prose.

## When to run

- A public type in `packages/core/src/types/` changed (e.g. `api.ts`,
  `config.ts`, `mock.ts`, `runner.ts`).
- A `**Type:**` / `**类型：**` block, or the prose describing a type's fields,
  was edited in `website/docs/**/api/**`.
- Reviewing a PR that touches either side.

Scope: every page with a `**Type:**` block — `api/runtime-api/**` and
`api/javascript-api/**`, both `en` and `zh`.

## Procedure

### 1. en/zh parity (deterministic — run the script first)

```bash
node .agents/skills/api-doc-sync/scripts/check-type-blocks.mjs
```

The en and zh pages must declare **structurally identical** signatures (only
the label and translated `//` comments may differ). The script enforces this
and exits non-zero on any mismatch, missing counterpart, or block-count
difference. Fix every reported drift before moving on. Use `--json` for a
machine-readable inventory of all blocks.

### 2. Source fidelity (per changed symbol — let `tsc` judge)

For each documented symbol whose page changed (or whose type changed):

1. **Find the source of truth.** Locate the exported type in
   `packages/core/src/types/` (start from `types/index.ts` re-exports). Read its
   real shape: every overload, parameter order, optionality, generics, and
   union members. Prefer the built `dist/**/*.d.ts` when available — it is the
   exact surface users consume; build with `pnpm --filter @rstest/core build`
   if needed.

2. **Turn the doc into compile assertions.** Write a throwaway `.ts` file
   **inside the repo** (e.g. the repo root or `packages/core/`, with a temp name
   like `__doc-probe.ts`) that imports the real type and exercises **every call
   form the docs show** as a positive case, plus a `// @ts-expect-error` for
   **every form the docs say is invalid** (e.g. "the options object cannot be the
   third argument"). It must live in the repo, not the external scratchpad: `tsc`
   resolves `node_modules` upward from the file's own directory, so only an
   in-workspace file can resolve `@rstest/core`. Run it, then delete it:

   ```bash
   npx tsc --noEmit --strict --skipLibCheck <scratch>.ts
   ```

   - A positive form that fails to compile → the docs show a call that does not
     exist. **Drift.**
   - An unused `@ts-expect-error` → a form the docs claim is rejected is
     actually accepted (or vice-versa). **Drift.**

3. **Check for under-documentation.** Enumerate the overloads / fields that the
   source type actually has and confirm each is represented in the doc
   signature or prose. The bug this skill exists for was a _missing overload_
   (the `(name, fn, timeout?)` shorthand was dropped from the `**Type:**`
   line) — a positive-only check will not catch that, so explicitly diff the
   source's overload set against the documented one.

4. **Check field-level claims.** When the prose lists option fields
   (`timeout`, `retry`, …), confirm each exists on the type with the stated
   optionality and meaning, and that no real field is omitted.

5. **Check named-type linkability.** A signature that names another type
   (`TestContext`, `TestOptions`, `RstestUtilities`, …) can be a bare, unlinked
   black box. For each named type a signature references, confirm the page
   either links it to its canonical definition or documents it inline. Only add
   a link when **both** hold:

   - (a) the type has a **canonical anchor** to point at — a real heading
     (`### TestContext` → `#testcontext`), not a loose bullet in a list (a
     bullet generates no anchor); and
   - (b) the type is **foreign** to the page — a data structure the reader must
     navigate elsewhere to understand, _not_ a fluent/chaining return type that
     names the very object the current page documents.

   When both hold (e.g. `TestContext` at
   `/api/runtime-api/test-api/test#testcontext`), add a short prose link after
   the signature — do **not** re-inline the type's members, which creates a
   second copy that drifts. The link goes in an adjacent sentence, since a
   markdown link cannot live inside the backticked `**Type:**` code span.

   When either test fails, treat the type as already inline-documented and skip
   it — no link noise. `RstestUtilities` is the canonical skip: no heading anchor
   (only a bullet gloss in `types.mdx`), and `=> RstestUtilities` is a fluent
   self-reference to the `rs`/`rstest` object these pages already document.

### 3. Fix drift at the doc layer

Apply fixes to the `.mdx` directly. For each fix:

- Update **both** `en` and `zh`; keep the signature blocks structurally
  identical (re-run the script in step 1 to confirm).
- Preserve the curated style — friendly names like `TestOptions`, omitted
  internal generics (`ExtraContext`) — as long as the omission is a faithful
  simplification, not a missing overload or wrong arg order.
- When a brand-new API/field is documented, set `<ApiMeta addedVersion="…" />`
  per the `development` skill's convention.

### 4. Re-verify

Re-run step 1 (parity) and step 2 (compile assertions) until both are clean,
then `pnpm prettier --check` the touched `.mdx` files.

## Notes

- The parity script is safe to wire into CI / pre-push as a hard gate — it is
  fully deterministic. The source-fidelity pass (step 2) is the judgement half
  and runs here, on demand.
- This skill does **not** generate signatures from source. Generation would
  make drift impossible but discards the curated/simplified style the docs use
  on purpose; that trade-off is intentionally out of scope.
