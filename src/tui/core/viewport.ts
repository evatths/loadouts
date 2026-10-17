import type { SpecPane } from "./viewspec.js";

/** Share a bounded viewport across sections, always keeping the selected row visible. */
export function windowPanes(panes: SpecPane[], height: number): SpecPane[] {
  // At tiny heights retain just the focused section rather than lose the cursor.
  const shown = height < panes.length * 2 ? panes.filter((pane) => pane.focused) : panes;
  const budgets = shown.map(() => 1);
  let remaining = Math.max(0, Math.floor(height) - shown.length * 2);
  while (remaining > 0) {
    let used = false;
    for (let i = 0; i < shown.length && remaining > 0; i++) {
      if (budgets[i] < shown[i].rows.length) { budgets[i]++; remaining--; used = true; }
    }
    if (!used) break;
  }
  return shown.map((pane, i) => {
    const count = budgets[i];
    if (pane.rows.length <= count) return pane;
    const selected = Math.max(0, pane.rows.findIndex((row) => row.selected));
    const start = Math.max(0, Math.min(selected - Math.floor(count / 2), pane.rows.length - count));
    return { ...pane, title: `${pane.title} · ${start + 1}–${start + count}`, rows: pane.rows.slice(start, start + count) };
  });
}

export function windowLines<T>(lines: T[], height: number, scroll = 0): T[] {
  const count = Math.max(1, Math.floor(height));
  const start = Math.max(0, Math.min(scroll, lines.length - count));
  return lines.slice(start, start + count);
}
