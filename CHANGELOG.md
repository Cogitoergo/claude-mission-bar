# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/Cogitoergo/claude-mission-bar/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Cogitoergo/claude-mission-bar/releases/tag/v0.1.0
