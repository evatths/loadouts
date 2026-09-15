import type { PermissionRuleset } from "@opencode/client";

/** Match OpenCode's permission wildcard vocabulary without interpolating a regex. */
export function matches(pattern: string, value: string): boolean {
  return new RegExp(`^${pattern.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`, "s").test(value);
}

export function skillDenied(id: string, permissions: PermissionRuleset): boolean {
  let effect: string | undefined;
  for (const rule of permissions) {
    if (matches(rule.action, "skill") && matches(rule.resource, id)) effect = rule.effect;
  }
  return effect === "deny";
}

/** Restrict only recognized advertisements; missing or unfamiliar markers are a no-op. */
export function filterSkillAdvertisement(text: string, visible: (id: string) => boolean): string {
  return text.replace(/<available_skills>[\s\S]*?<\/available_skills>/g, (block) =>
    block.replace(/<skill>\s*<id>([^<]+)<\/id>[\s\S]*?<\/skill>/g, (skill, id: string) => visible(id.trim()) ? skill : ""));
}
