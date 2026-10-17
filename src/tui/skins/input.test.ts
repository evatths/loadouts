import { describe, expect, it } from "vitest";
import type { KeyEvent } from "@opentui/core";
import { intentFromOpenTuiKey } from "./opentui/input.js";
import { intentFromPiTuiInput } from "./pi-tui/input.js";
import { createInitialModel } from "../core/model.js";
import { view } from "../core/view.js";

const spec = view(createInitialModel({ rows: [], active: [], tools: [], issues: [], warnings: [] }));
const event = (name: string, sequence = name, shift = false) => ({ name, sequence, shift, ctrl: false, meta: false, option: false }) as KeyEvent;

describe("shared navigation through both input adapters", () => {
  it.each([
    ["h", { t: "section", dir: -1 }], ["l", { t: "section", dir: 1 }],
    ["[", { t: "cycleScope", dir: -1 }], ["]", { t: "cycleScope", dir: 1 }],
    ["1", { t: "selectSection", section: "active" }], ["2", { t: "selectSection", section: "available" }],
    ["3", { t: "selectSection", section: "issues" }], ["g", { t: "topPrefix" }],
    ["G", { t: "edge", edge: "last" }], ["m", { t: "cycleMode" }],
  ])("maps %s consistently", (key, intent) => {
    expect(intentFromPiTuiInput(key as string, spec)).toEqual(intent);
    expect(intentFromOpenTuiKey(event(key as string), spec)).toEqual(intent);
  });

  it.each([
    ["\t", "tab", false, { t: "section", dir: 1 }],
    ["\u001b[Z", "tab", true, { t: "section", dir: -1 }],
    ["\u001b[D", "left", false, { t: "section", dir: -1 }],
    ["\u001b[C", "right", false, { t: "section", dir: 1 }],
    ["\u001b[H", "home", false, { t: "edge", edge: "first" }],
    ["\u001b[F", "end", false, { t: "edge", edge: "last" }],
    ["\u001b[5~", "pageup", false, { t: "detailScroll", delta: -5 }],
    ["\u001b[6~", "pagedown", false, { t: "detailScroll", delta: 5 }],
  ])("retains terminal navigation %s", (sequence, name, shift, intent) => {
    expect(intentFromPiTuiInput(sequence, spec)).toEqual(intent);
    expect(intentFromOpenTuiKey(event(name, sequence, shift), spec)).toEqual(intent);
  });

  it("treats navigation letters and brackets as text while filtering, including Kitty input", () => {
    const filtering = { ...spec, footer: { ...spec.footer, filter: { active: true, text: "" } } };
    for (const key of ["h", "l", "[", "]", "g", "G", "1", "m"]) {
      expect(intentFromPiTuiInput(key, filtering)).toEqual({ t: "filterChar", char: key });
      expect(intentFromOpenTuiKey(event(key), filtering)).toEqual({ t: "filterChar", char: key });
    }
    expect(intentFromPiTuiInput("\u001b[91u", spec)).toEqual({ t: "cycleScope", dir: -1 });
    expect(intentFromPiTuiInput("\u001b[91u", filtering)).toEqual({ t: "filterChar", char: "[" });
    expect(intentFromOpenTuiKey(event("g", "\u001b[103;2u", true), spec)).toEqual({ t: "edge", edge: "last" });
    const modified = event("l");
    modified.ctrl = true;
    expect(intentFromOpenTuiKey(modified, spec)).toBeUndefined();
  });
});
