# @rstest/cdp-debug

CDP-based debugger CLI for rstest, designed for use by [rstackjs/agent-skills](https://github.com/rstackjs/agent-skills).

**Important:** This CLI is intended to be invoked by AI agents, not for direct human use. Agents use the skill definition to generate plans and interpret results automatically.

This package provides a command-line tool that helps debug failing rstest tests by:

- Running a single test file in a single worker under the Node inspector (CDP)
- Setting sourcemap-mapped breakpoints
- Evaluating expressions to inspect intermediate variables

## Usage

```bash
# Read plan from a file
npx @rstest/cdp-debug --plan plan.json

# Read plan from stdin (using heredoc)
npx @rstest/cdp-debug --plan - <<'EOF'
{
  "runner": {
    "cmd": "pnpm",
    "args": ["rstest", "run", "--include", "test/example.test.ts"],
    "cwd": "/path/to/project"
  },
  "tasks": [
    {
      "sourcePath": "/path/to/project/src/example.ts",
      "line": 42,
      "column": 0,
      "expressions": ["value", "typeof value"]
    }
  ]
}
EOF
```

## Commands (for development)

```bash
pnpm --filter @rstest/cdp-debug build
pnpm --filter @rstest/cdp-debug dev
pnpm --filter @rstest/cdp-debug gen:schema
pnpm --filter @rstest/cdp-debug typecheck
```

## Plan schema

The plan JSON Schema (draft-07) is generated from Valibot schemas and committed to this repository:

- `packages/skill-cdp-debug/schema/plan.schema.json`

## Related

- Skill definition: maintained at [rstackjs/agent-skills](https://github.com/rstackjs/agent-skills)
