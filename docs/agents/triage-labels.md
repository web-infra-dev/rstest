# Triage labels

The engineering skills speak in terms of two canonical category roles and five canonical state roles. This file maps those roles to the actual label strings used in `web-infra-dev/rstest`.

## Category roles

| Canonical role | Label in our tracker | Meaning                    |
| -------------- | -------------------- | -------------------------- |
| `bug`          | `bug`                | Something is broken        |
| `enhancement`  | `enhancement`        | New feature or improvement |

## State roles

| Canonical role    | Label in our tracker | Meaning                                  |
| ----------------- | -------------------- | ---------------------------------------- |
| `needs-triage`    | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`      | `need reproduction`  | Waiting on reporter for more information |
| `ready-for-agent` | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human` | `ready-for-human`    | Requires human implementation            |
| `wontfix`         | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

Notes:

- `needs-info` maps to the pre-existing `need reproduction` label; for non-reproduction information requests it still applies — the triage notes comment carries the specific questions.
- `bug`, `enhancement`, and `wontfix` reuse the repo's pre-existing labels.
