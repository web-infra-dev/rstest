# @rstest/typecheck

- Core owns discovery, run finalization, and reporter dispatch. The optional package implements the core-owned `TypecheckHostModule` contract and sends events through `createRunnerEventSink`. It must have exactly the same version as core.
- Keep the public assertion and registration entry independent of the host entry. Its generated declarations must not import core or bundler configuration types.
- Collect original TypeScript without evaluating registrations. Binding resolution must account for declarations that occur after a call; offsets must remain UTF-16 so compiler diagnostics and source locations agree.
- Use the project compiler CLI for both diagnostics and checked input files in one invocation. A successful exit alone cannot prove a discovered test was checked. Preserve whole-project diagnostics when filtering reported cases.
