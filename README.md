# mission-bar

[![CI](https://github.com/Cogitoergo/claude-mission-bar/actions/workflows/ci.yml/badge.svg)](https://github.com/Cogitoergo/claude-mission-bar/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A [Claude Code](https://code.claude.com/docs) mod that puts a bar above the
prompt showing where the current work stands: task progress, a live ETA, how
much of your 5-hour and weekly usage the tasks are costing, and when the
context is full enough that a new session would be cheaper.

```
╭──────────────────────────────────────────────────────────────────────────────╮
│ ◆ MISSION ████████░░░░░░░░░░░░ 2/5  ETA ~36m  elapsed 24m               hide │
│ ▶ Wiring the export endpoint                                                 │
│ ○ Add pagination to the list view                                            │
│ ○ Write integration tests                                                    │
│ 5h 41% · tasks +6.5% · ~+9.8% to go   7d 18% · tasks +0.9% · ~+1.4% to go    │
│ context 62%   cache 94%                                                      │
│ ⚠ Context 62% full: plan a new session, or /compact, at the next natural     │
│   break.                                                                     │
╰──────────────────────────────────────────────────────────────────────────────╯
```

It makes no model requests. Every figure is one the session already holds, so
the bar adds nothing to your usage.

## What it shows

| Part | Where it comes from | Exact or estimated |
| --- | --- | --- |
| Progress bar, done/total, current and next tasks | The session's task list (`TaskCreate`, `TaskUpdate`, `TodoWrite`) | Exact |
| ETA | Average working time per completed task, times the tasks left | Estimated |
| `5h` and `7d` fill | The rate-limit windows the last API response reported | Exact |
| `tasks +N%` | The window's fill now, less its fill when the first task was created | Exact |
| `~+N% to go` | Usage per working minute so far, times the ETA | Estimated |
| `context` | The context window's fill, as the status line reports it | Exact |
| `cache` | Share of the last turn's prompt served from the prompt cache | Exact |

Details worth knowing:

- **The ETA appears after the first task completes.** Before that there is no
  pace to go by, and the bar says so instead of guessing.
- **The ETA counts working time**, not time spent waiting for you, and
  refreshes every 15 seconds while a turn runs.
- **Tasks are only tracked when Claude keeps a task list.** Without one the
  bar shows usage and context alone.
- **Without rate-limit readings** (an API key rather than a subscription, for
  example) the bar shows the session's cost in dollars instead.
- **A window that resets mid-run** is counted from zero from that point.

## Context and cache advice

| Condition | What the bar does |
| --- | --- |
| Context at 60% or more | Shows a note to plan a new session or `/compact` |
| Context at 80% or more | Turns the border red, recommends a new session, and shows a one-time toast |
| Last turn reused under 50% of its prompt from cache, with context at 30% or more | Notes that most of the context was paid for again |

The thresholds are constants at the top of [`hooks/estimate.ts`](hooks/estimate.ts).

## Install

At the prompt of a terminal session:

```
/plugin install mission-bar --marketplace Cogitoergo/claude-mission-bar
```

From a shell:

```bash
claude plugin install mission-bar --marketplace Cogitoergo/claude-mission-bar
```

In the desktop app, where `/plugin` does not run: click **+** next to the
prompt box, then **Plugins**, **Add marketplace** with
`Cogitoergo/claude-mission-bar`, then **Add plugin**.

Choose the user scope to have the bar in every session on that machine.

## Use

The bar appears above the prompt once the mod is loaded. `/mission-bar`, or
the `hide` button on the bar, shows or hides it.

## Update

```bash
claude plugin update mission-bar
```

Then run `/reload-plugins` in a running session, or start a new one.

## Compatibility

Built and tested on Claude Code 2.1.322, on the terminal, desktop, VS Code and
mobile surfaces. The plugin API the mod uses is early access and can change
between Claude Code releases; if the bar stops drawing after an update, please
[open an issue](https://github.com/Cogitoergo/claude-mission-bar/issues).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the project layout, how to run the
checks, and how branches and releases work. Changes are listed in
[CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE)
