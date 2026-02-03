# CDP debug E2E fixtures

This folder hosts fixtures for the `@rstest/cdp` CLI.

**Important:** This CLI is designed to be invoked by AI agents via https://github.com/rstackjs/agent-skills, not for direct human use. The skill definition (`skills/rstest-cdp/SKILL.md`) provides structured guidance for agents to generate plans and interpret results.

This e2e suite exists to keep the CLI contract stable for the skill:

- Plan input (`--plan` file or `-` for stdin)
- JSON output on stdout (`DebugResult`)
- Runner output on stderr

The fixtures are intentionally self-contained so the skill can be moved into a different repo without relying on `examples/`.
