# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.4] - 2026-06-09

### Fixed
- Fix custom kind loading to avoid repeated namespace and duplicate-registration warnings during routine commands

## [0.2.3] - 2026-05-21

### Added
- Add `loadouts docs compatibility` with built-in tool path and frontmatter compatibility notes
- Add `loadouts add-to` and `loadouts remove-from` to manage loadout include lists without editing YAML by hand

## [0.2.2] - 2026-05-21

### Added
- Add canonical rule and skill frontmatter handling with render-time tool aliases
- Add `loadouts install [source]` to import artifacts from a specific file or directory

### Changed
- Change `doctor` output to use unified artifact-first drift tables with tool columns

### Fixed
- Fix `doctor --fix` to support artifact-by-artifact repair selection and default Enter-to-apply behavior
- Fix `doctor` diagnostics to include issue path and reason details for unresolved target drift

## [0.2.0] - 2026-05-14

### Added
- Add OpenCode support with `.opencode` config and plugin management

### Fixed
- Fix global `.gitignore` updates so bundled artifacts are tracked correctly
- Fix bundled OpenCode skill naming to use `loadout-usage`

## [0.1.15] - 2026-05-13

### Added
- Add `loadouts doctor` to diagnose and repair gitignore migration drift

### Changed
- Expand `loadouts update` gitignore migration to cover global scope as well as project scope

### Fixed
- Fix `list` to show colliding loadout names across scopes as separate rows

## [0.1.14] - 2026-05-12

### Added
- Add bundled loadouts to `list` and `info` output before a project is initialized

### Changed
- Change sync/deactivate cleanup to remove empty parent directories for directory-layout artifacts

### Fixed
- Fix sync to preserve external symlinked base paths
- Fix `create --no-edit` to skip opening the editor
- Fix gitignore handling for the `.loadouts` state file path

## [0.1.13] - 2026-05-11

### Changed
- Migrate to per-target `.gitignore` files for better tool-specific configuration management

## [0.1.12] - 2026-05-10

### Added
- Update gitignore at artifact creation time (`skill add`, `rule add`, `install`)
- Use directory patterns for skills in gitignore (e.g., `.cursor/skills/foo/`)
- Command aliases: `a` (activate), `d` (deactivate), `c` (check), etc.

### Changed
- Collapse dir-layout artifacts (skills) to single row per artifact in sync output

### Fixed
- Fallback script uses marker file to avoid re-running on each shell
- Fallback script cleans up broken symlinks before creating new ones
- Fallback script uses correct path for AGENTS.md instruction

## [0.1.11] - 2026-05-08

### Changed
- Renamed package from `@evatt/loadout` to `loadouts`
- Renamed CLI binary from `loadout` to `loadouts`
- Project config directory renamed from `.loadout/` to `.loadouts/`
- Root config file renamed from `loadout.yaml` to `loadouts.yaml`
- Global config moved from `~/.config/loadout` to `~/.config/loadouts`

## [0.1.10] - 2026-05-08

### Added
- CI/CD pipeline with GitHub Actions
- Automated npm publishing via OIDC Trusted Publishers
- Version tag verification in release workflow
- Update notifications (`loadouts update` command)

### Changed
- Release workflow now requires Node 24 for npm 11.x (Trusted Publishers support)

## [0.1.0] - 2026-05-07

### Added
- Initial release
- Core loadout system with artifacts: rules, skills, instructions, extensions
- Multi-tool support: Claude Code, Cursor, OpenCode, Codex, Pi
- Global and project-scoped configurations
- Sources for cross-project configuration sharing
- CLI commands: `activate`, `deactivate`, `sync`, `status`, `check`, `list`, `info`, `create`, `edit`, `init`
- Per-loadout instructions with `AGENTS.<loadout>.md` pattern
- Unified table format with scope indicators
