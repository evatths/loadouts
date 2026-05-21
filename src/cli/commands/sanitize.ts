/**
 * loadout sanitize — Rewrite artifact frontmatter to Loadouts canonical form.
 *
 * Currently sanitizes:
 *   - Rule frontmatter: canonical `description`, `paths`, and `activation`
 *   - Skill frontmatter: canonical invocation fields and known native aliases
 *
 * Scope flags:
 *   -l / --local   → project scope only
 *   -g / --global  → global scope only
 *   -a / --all     → both scopes (default)
 */

import { Command } from "commander";
import * as path from "node:path";
import { resolveContexts, SCOPE_FLAGS, type ScopeFlags } from "../../core/scope.js";
import {
  findUnsanitizedRules,
  findUnsanitizedSkills,
  sanitizeRuleFile,
  sanitizeSkillFile,
} from "../../core/config.js";
import { log, heading } from "../../lib/output.js";

interface SanitizeOptions extends ScopeFlags {
  dryRun?: boolean;
}

export const sanitizeCommand = new Command("sanitize")
  .description("Sanitize artifact frontmatter to canonical form")
  .option(...SCOPE_FLAGS.local)
  .option(...SCOPE_FLAGS.global)
  .option(...SCOPE_FLAGS.all)
  .option("--dry-run", "Show what would be sanitized without modifying files")
  .action(async (options: SanitizeOptions) => {
    const { contexts } = await resolveContexts(options);

    let totalFixed = 0;
    let totalSkipped = 0;

    for (const ctx of contexts) {
      const label = ctx.scope === "global" ? "Global" : "Project";
      const unsanitizedRules = findUnsanitizedRules(ctx.configPath);
      const unsanitizedSkills = findUnsanitizedSkills(ctx.configPath);

      if (unsanitizedRules.length === 0 && unsanitizedSkills.length === 0) {
        log.dim(`[${ctx.scope}] All rule and skill frontmatter is canonical`);
        continue;
      }

      heading(`${label} artifacts needing sanitization`);

      for (const name of unsanitizedRules) {
        const rulePath = path.join(ctx.configPath, "rules", `${name}.md`);

        if (options.dryRun) {
          log.dim(`  Would sanitize rule: ${name}`);
          totalSkipped++;
        } else {
          sanitizeRuleFile(rulePath);
          log.success(`  Sanitized rule: ${name}`);
          totalFixed++;
        }
      }

      for (const name of unsanitizedSkills) {
        const skillPath = path.join(ctx.configPath, "skills", name, "SKILL.md");

        if (options.dryRun) {
          log.dim(`  Would sanitize skill: ${name}`);
          totalSkipped++;
        } else {
          sanitizeSkillFile(skillPath);
          log.success(`  Sanitized skill: ${name}`);
          totalFixed++;
        }
      }

      console.log();
    }

    if (options.dryRun) {
      if (totalSkipped > 0) {
        log.info(
          `${totalSkipped} artifact(s) would be sanitized. Run without --dry-run to apply.`
        );
      }
    } else if (totalFixed > 0) {
      log.success(`Sanitized ${totalFixed} artifact(s)`);
      log.dim("Run 'loadouts sync' to apply changes to tool directories.");
    } else {
      log.success("All artifacts are already sanitized");
    }
  });
