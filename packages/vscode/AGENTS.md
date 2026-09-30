# AGENTS.md

**This extension is frozen. Do not change it.** The standalone Rstest extension (`rstack.rstest`) shipped its final release and is superseded by the unified Rstack extension (`rstack.rstack`, https://github.com/rstackjs/rstack-editor). New editor features and fixes go to rstack-editor, never here.

The package version is excluded from the release train (`bump.config.mts`, `scripts/checkVersionConsistency.mjs`) and must stay at its final value.

The only remaining work is the sunset tracked in rstackjs/rstack-editor#75: registry deprecation, removing the release job and the E2E step from `.github/workflows`, and finally deleting `packages/vscode` together with its references in the root `package.json`, `knip.jsonc`, `.github/renovate.json5`, `pnpm-workspace.yaml`, `.gitignore`, `.vscode/`, the root `AGENTS.md`, and `.agents/skills/create-release-blog/SKILL.md`. Follow that issue's checklist; do not touch the extension source for anything else.
