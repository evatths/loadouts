import { describe, expect, it } from "vitest";
import { filterSkillAdvertisement, skillDenied } from "./advertisement.js";

describe("session skill advertisement", () => {
  it("filters only complete recognized skill blocks without interpreting IDs as regexes", () => {
    const visible = "<skill>\n<id>keep</id><description>keep me</description></skill>";
    const hidden = "<skill><id>a.b</id><description>remove me</description></skill>";
    const input = `prefix <available_skills>${hidden}${visible}</available_skills> suffix`;
    expect(filterSkillAdvertisement(input, (id) => id !== "a.b")).toBe(`prefix <available_skills>${visible}</available_skills> suffix`);
    expect(filterSkillAdvertisement("unrecognized <skill>format</skill>", () => false)).toBe("unrecognized <skill>format</skill>");
  });
  it("respects last-match-wins and wildcard rules", () => {
    const rules = [{ action: "skill", resource: "*", effect: "deny" as const }, { action: "skill", resource: "review-*", effect: "ask" as const }];
    expect(skillDenied("other", rules)).toBe(true);
    expect(skillDenied("review-code", rules)).toBe(false);
    expect(skillDenied("a+b", [{ action: "skill", resource: "a+b", effect: "deny" }])).toBe(true);
  });
});
