---
description: Release guidelines
activation: always
---
# Release Process

To publish a new version:

1. Update `CHANGELOG.md` (see guidelines below)
2. Run:
   ```bash
   npm version patch   # or minor/major
   git push && git push --tags
   ```

CI will verify the tag matches package.json, then publish to npm via OIDC.

## Changelog Guidelines

**Assess changes:**
```bash
git log --oneline $(git describe --tags --abbrev=0)..HEAD
```

**Writing entries:**
- Group under: Added, Changed, Fixed, Removed
- Write for users, not developers — focus on *what changed* for them
- One line per change, start with a verb (Add, Fix, Change, Remove)
- Omit: refactors, CI tweaks, dependency bumps (unless security-relevant)
- Consolidate related commits into single entries
