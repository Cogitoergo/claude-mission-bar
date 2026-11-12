# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.1] - 2026-11-12

### Fixed

- `claude plugin list` reported "Hook load failed: expected record, received
  undefined at path hooks" on some builds. `hooks/hooks.json` now carries an
  empty `hooks` record beside `modules`, which those builds require.

## [0.5.0] - 2026-11-12

### Fixed

- The desktop app's task list is now followed to the end. After its first
  call the app sends `update_plan` with only `advance: true`, meaning "the
  current task is done, start the next", which the bar ignored; it stayed on
  0 of N. `wrap_up` now completes the last task.
- Elapsed time and the ETA count real time through short pauses between
  turns, such as a background command, and refresh every 5 seconds. A pause
  of more than ten minutes is taken as the person being away and not counted.

### Changed

- In the apps each gauge is drawn as one rounded pill, so its shape and
  spacing no longer depend on how the app paints boxes.

### Added

- A rocket mascot at the right of the bar: flying with a flickering flame
  while Claude works, parked when idle, and ticked when every task is done.

## [0.4.1] - 2026-11-12

### Added

- `/mission-bar debug` now lists the mod's recent activity: each turn event
  and each task-list call, with what was read from it and whether it was
  applied.

### Fixed

- A task-list update that never finishes no longer holds back every later
  update.
- Plan updates that carry statuses without the task text are applied to the
  tasks already known.

## [0.4.0] - 2026-11-12

### Added

- Task lists kept with `update_plan`, as the desktop app keeps them, are now
  followed, along with any whole-list tool whose entries carry a status.
- `/mission-bar debug` prints diagnostics: the Claude Code version, the
  surfaces attached, the tasks tracked and the tool names seen.

### Changed

- Task tools are matched loosely by name and their results read more
  tolerantly, so builds that spell them differently are still tracked.

## [0.3.0] - 2026-11-12

### Added

- The bar now works without a task list. When Claude keeps none, it counts by
  prompt: how long the running or last prompt took, the points it added to
  the 5-hour and 7-day windows, the average per prompt, and roughly how many
  more prompts the 5-hour window has room for.

## [0.2.1] - 2026-11-12

### Changed

- The README now describes what each hook does.
- The icon is a smaller, flat-colour PNG.

## [0.2.0] - 2026-11-12

### Changed

- Redesigned the bar. In the desktop app, VS Code and mobile it now draws
  vector graphics: a gradient progress bar, ring gauges for the 5-hour and
  7-day windows, context and cache, and a larger ETA.
- In the terminal the progress bar is a colour gradient, each figure has a
  small meter, and gauges turn amber and red as they fill.

### Added

- Animation while a turn runs: a highlight sweeping the progress bar and a
  pulsing marker on the task in progress. The apps animate the drawings
  themselves; the terminal redraws four times a second, and only while a
  turn is running.

## [0.1.0] - 2026-11-12

### Added

- Bar above the prompt with a progress bar, done/total count, the task in
  progress and the next tasks, read from the session's task list
  (`TaskCreate`, `TaskUpdate`, `TodoWrite`).
- ETA from the pace of completed tasks, counted in working time and refreshed
  every 15 seconds while a turn runs.
- 5-hour and 7-day usage: the window's fill, the points the current tasks have
  added, and the points they are projected to add. Falls back to session cost
  when no rate-limit reading is available.
- Context fill and prompt-cache reuse, with a note from 60% context and a
  recommendation to start a new session from 80%.
- `/mission-bar` command and a `hide` button to show or hide the bar.

[Unreleased]: https://github.com/Cogitoergo/claude-mission-bar/compare/v0.5.1...HEAD
[0.5.1]: https://github.com/Cogitoergo/claude-mission-bar/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/Cogitoergo/claude-mission-bar/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/Cogitoergo/claude-mission-bar/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/Cogitoergo/claude-mission-bar/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/Cogitoergo/claude-mission-bar/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/Cogitoergo/claude-mission-bar/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/Cogitoergo/claude-mission-bar/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Cogitoergo/claude-mission-bar/releases/tag/v0.1.0
