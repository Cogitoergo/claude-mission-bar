# Contributing

Issues and pull requests are welcome.

## Project layout

| Path | What it holds |
| --- | --- |
| `.claude-plugin/plugin.json` | The plugin manifest |
| `.claude-plugin/marketplace.json` | Makes this repository installable as a marketplace |
| `hooks/register.tsx` | The hooks module: event hooks and the bar's drawing |
| `hooks/estimate.ts` | Pure functions: ETA, usage projection, advice, formatting |
| `hooks/register.test.tsx` | Tests, run by `claude plugin test` |
| `types/index.d.ts` | The contract for the values the mod keeps in `$.state` |

## Developing

You need [Claude Code](https://code.claude.com/docs) installed. Load the mod
from your working copy, with hot reload on save:

```bash
claude --plugin-dir .
```

Before opening a pull request, run both checks:

```bash
claude plugin validate .
```

```bash
claude plugin test .
```

Once Claude Code has loaded the mod from the folder, it writes its type
declarations to `.claude-plugin/types/` (git-ignored), and `tsc -p .`
type-checks the mod against them.

## Guidelines

- The mod must stay free to run: no model requests, and no call that costs
  usage. It reads only figures the session already holds.
- Keep calculations in `hooks/estimate.ts` as pure functions, and cover new
  behaviour with a test.
- When a stored value's fields change, change its `shape` tag in
  `hooks/register.tsx` so values stored by an older version are declined.
- The plugin API is early access and can change between Claude Code releases.
  Say which Claude Code version you tested on.

## Branches and releases

- The default branch is always releasable. Work happens on short-lived
  branches (`feat/...`, `fix/...`, `docs/...`) merged through pull requests.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/).
- To release, bump `version` in `.claude-plugin/plugin.json` and move the
  `Unreleased` notes in `CHANGELOG.md` under the new version. When that lands
  on the default branch, the Release workflow validates and tests the plugin,
  tags the commit `vX.Y.Z` and publishes a GitHub release with those notes.
  Versions follow Semantic Versioning.
