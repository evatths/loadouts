/** @jsxImportSource @opentui/solid */

import type { KeyEvent, MouseEvent } from "@opentui/core";
import { createSignal } from "solid-js";
import type { Intent } from "../../core/intent.js";
import type { SpecSpan, ViewSpec } from "../../core/viewspec.js";
import type { ThemeTokens } from "../../core/theme.js";
import { intentFromOpenTuiKey } from "./input.js";
import { colorFor, type OpenTuiThemeTokens } from "./theme.js";
import { windowLines, windowPanes } from "../../core/viewport.js";

interface DashboardProps {
  spec: ViewSpec;
  theme?: OpenTuiThemeTokens | ThemeTokens;
  onIntent?: (intent: Intent) => void;
}

export function Dashboard(props: DashboardProps) {
  const [listHeight, setListHeight] = createSignal(20);
  const [detailHeight, setDetailHeight] = createSignal(20);
  const onKey = (event: KeyEvent) => {
    const intent = intentFromOpenTuiKey(event, props.spec);
    if (!intent) return;
    event.preventDefault();
    event.stopPropagation();
    props.onIntent?.(intent);
  };
  const onScroll = (event: MouseEvent, target: "move" | "detailScroll") => {
    const direction = event.scroll?.direction;
    if (direction !== "up" && direction !== "down") return;
    event.preventDefault();
    event.stopPropagation();
    props.onIntent?.({ t: target, delta: (direction === "up" ? -1 : 1) * (target === "move" ? 1 : 5) });
  };

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor={props.theme?.background} focusable onKeyDown={onKey} focused>
      <box height={2} flexShrink={0} paddingLeft={2} flexDirection="column">
        <SpanLine spans={props.spec.tabs} theme={props.theme} />
        <SpanLine spans={props.spec.mode} theme={props.theme} />
      </box>
      <box flexGrow={1} minHeight={0} flexDirection="row" paddingLeft={1} paddingRight={1} paddingTop={1} gap={1}>
        <box width="52%" minWidth={20} border borderColor={colorFor(props.theme, "border")} flexDirection="column" paddingLeft={1} paddingRight={1} onMouseScroll={(event) => onScroll(event, "move")} onSizeChange={function () { setListHeight(Math.max(2, this.height - 3)); }}>
          <text height={1} flexShrink={0} fg={colorFor(props.theme, "accent")}><b>LOADOUTS</b></text>
          {windowPanes(props.spec.panes, listHeight()).map((pane) => (
            <box flexDirection="column" flexShrink={0}>
              <text height={1} fg={colorFor(props.theme, pane.focused ? "accent" : "muted")}>{pane.focused ? "▸" : " "} {pane.title}</text>
              {pane.rows.length === 0 ? (
                <text fg={colorFor(props.theme, "dim")}>  -- empty --</text>
              ) : pane.rows.map((row) => (
                <box height={1} flexShrink={0} flexDirection="row" backgroundColor={row.selected ? props.theme?.selectedBackground : undefined}>
                  <SpanLine spans={[
                    { text: row.selected ? "▸ " : "  ", style: row.selected ? "accent" : "dim" },
                    { text: `${row.glyph.char} `, style: row.glyph.style }, ...row.spans,
                  ]} theme={props.theme} />
                </box>
              ))}
            </box>
          ))}
        </box>

        <box flexGrow={1} minWidth={18} border borderColor={colorFor(props.theme, "border")} flexDirection="column" paddingLeft={1} paddingRight={1} onMouseScroll={(event) => onScroll(event, "detailScroll")} onSizeChange={function () { setDetailHeight(Math.max(1, this.height - 5)); }}>
          <text height={1} flexShrink={0} fg={colorFor(props.theme, "accent")}><b>{props.spec.detail?.title ?? "Detail"}</b></text>
          <box flexDirection="column" marginTop={1} gap={0} flexGrow={1}>
            {windowLines(props.spec.detail?.blocks ?? [[{ text: "No detail", style: "dim" as const }]], detailHeight(), props.spec.detail?.scroll).map((block) => (
              <SpanLine spans={block} theme={props.theme} />
            ))}
          </box>
          <text height={1} flexShrink={0} fg={colorFor(props.theme, "dim")}>pgup/pgdn scroll details</text>
        </box>
      </box>

      {props.spec.overlay ? <Overlay spec={props.spec.overlay} theme={props.theme} onScroll={(event) => onScroll(event, "move")} /> : null}

      <box height={4} flexShrink={0} border borderColor={colorFor(props.theme, "border")} paddingLeft={1} paddingRight={1} flexDirection="column">
        <SpanLine spans={props.spec.footer.equipped} theme={props.theme} />
        <text height={1} fg={colorFor(props.theme, "dim")}>
          {props.spec.footer.keys.map((key) => `${key.key === "[/]" ? "[ / ]" : `[${key.key}]`} ${key.label}`).join("  ")}
          {props.spec.footer.filter?.active ? `  filter: ${props.spec.footer.filter.text}` : ""}
        </text>
      </box>
    </box>
  );
}

function Overlay(props: { spec: NonNullable<ViewSpec["overlay"]>; theme?: DashboardProps["theme"]; onScroll: (event: MouseEvent) => void }) {
  const [height, setHeight] = createSignal(12);
  return (
    <box position="absolute" left="12%" top="10%" width="76%" height="78%" border borderColor={colorFor(props.theme, props.spec.kind === "diff" ? "warning" : "accent")} backgroundColor={props.theme?.background} flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} onMouseScroll={props.onScroll} onSizeChange={function () { setHeight(Math.max(1, this.height - 8)); }}>
      <text height={1} flexShrink={0} fg={colorFor(props.theme, "accent")}><b>{props.spec.title}</b></text>
      <box flexDirection="column" marginTop={1} flexGrow={1} flexShrink={0}>
        {windowLines(props.spec.lines, height(), props.spec.scroll).map((line) => <SpanLine spans={line} theme={props.theme} />)}
      </box>
      <text height={1} flexShrink={0} fg={colorFor(props.theme, "dim")}>{props.spec.kind === "confirm" ? "h/l choose · enter confirm · esc cancel" : "j/k scroll · esc to close"}</text>
    </box>
  );
}

function SpanLine(props: { spans: SpecSpan[]; theme?: DashboardProps["theme"] }) {
  return (
    <text height={1} flexShrink={0} fg={colorFor(props.theme, "text")}>
      {props.spans.map((span) => <span style={{ fg: colorFor(props.theme, span.style ?? "text") }}>{span.text}</span>)}
    </text>
  );
}
