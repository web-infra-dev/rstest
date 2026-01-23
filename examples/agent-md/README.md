# Agent-MD Reporter Example

This example demonstrates the difference between the default reporter and the agent-md reporter.

## What it covers

- A realistic invoice calculation flow across multiple modules
- A checkout flow with async failures and shipping/tax logic
- A failing assertion with diff output
- A thrown error with a mismatched error message
- A snapshot mismatch
- A timeout failure
- Console output for agent context

## Run locally

From the repo root:

```bash
pnpm --filter @examples/agent-md test:human
```

## Run in agent mode

The agent-md reporter activates when it detects an agent environment. You can simulate this with the `OPENCODE=1` or `AI_AGENT` environment variable.

```bash
OPENCODE=1 pnpm --filter @examples/agent-md test:agent
```

Or:

````bash
AI_AGENT=demo-agent pnpm --filter @examples/agent-md test:agent

## Force default reporter

```bash
RSTEST_FORCE_DEFAULT=1 pnpm --filter @examples/agent-md test:human
````

```

## What to compare

- Default reporter output: human-readable summary + inline stack
- Agent-md output: structured Markdown with a JSON summary, detailed failure blocks, and repro commands

This makes it easy to benchmark how much context a code agent can consume and how reliably it can parse the output.
```
