/** @jsxImportSource @opentui/solid */

import type { KeyEvent } from "@opentui/core";
import type { Intent } from "../../core/intent.js";
import type { SpecSpan, ViewSpec } from "../../core/viewspec.js";
import type { ThemeTokens } from "../../core/theme.js";
import { intentFromOpenTuiKey } from "./input.js";
import { colorFor, type OpenTuiThemeTokens } from "./theme.js";

interface DashboardProps {
  spec: ViewSpec;
  theme?: OpenTuiThemeTokens | ThemeTokens;
  onIntent?: (intent: Intent) => void;
}

export function Dashboard(props: DashboardProps) {
  const onKey = (event: KeyEvent) => {
    const intent = intentFromOpenTuiKey(event, props.spec);
    if (!intent) return;
    event.preventDefault();
    event.stopPropagation();
    props.onIntent?.(intent);
  };

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor={props.theme?.background} focusable onKeyDown={onKey} focused>
      <box flexGrow={1} minHeight={0} flexDirection="row" paddingLeft={1} paddingRight={1} paddingTop={1} gap={1}>
        <scrollbox width="52%" minWidth={20} border borderColor={colorFor(props.theme, "border")} flexDirection="column" paddingLeft={1} paddingRight={1}>
          <text fg={colorFor(props.theme, "accent")}><b>LOADOUTS</b></text>
          {props.spec.panes.map((pane) => (
            <box flexDirection="column" marginTop={1}>
              <text fg={colorFor(props.theme, "accent")}>▸ {pane.title}</text>
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
        </scrollbox>

        <scrollbox flexGrow={1} minWidth={18} border borderColor={colorFor(props.theme, "border")} flexDirection="column" paddingLeft={1} paddingRight={1}>
          <text fg={colorFor(props.theme, "accent")}><b>{props.spec.detail?.title ?? "Detail"}</b></text>
          <box flexDirection="column" marginTop={1} gap={0}>
            {(props.spec.detail?.blocks ?? [[{ text: "No detail", style: "dim" as const }]]).map((block) => (
              <SpanLine spans={block} theme={props.theme} />
            ))}
          </box>
        </scrollbox>
      </box>

      {props.spec.overlay ? <Overlay spec={props.spec.overlay} theme={props.theme} /> : null}

      <box height={4} flexShrink={0} border borderColor={colorFor(props.theme, "border")} paddingLeft={1} paddingRight={1} flexDirection="column">
        <SpanLine spans={props.spec.footer.equipped} theme={props.theme} />
        <text height={1} fg={colorFor(props.theme, "dim")}>
          {props.spec.footer.keys.map((key) => `[${key.key}] ${key.label}`).join("  ")}
          {props.spec.footer.filter?.active ? `  filter: ${props.spec.footer.filter.text}` : ""}
        </text>
      </box>
    </box>
  );
}

function Overlay(props: { spec: NonNullable<ViewSpec["overlay"]>; theme?: DashboardProps["theme"] }) {
  return (
    <box position="absolute" left="12%" top="10%" width="76%" maxHeight="78%" border borderColor={colorFor(props.theme, props.spec.kind === "diff" ? "warning" : "accent")} backgroundColor={props.theme?.background} flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
      <text fg={colorFor(props.theme, "accent")}><b>{props.spec.title}</b></text>
      <box flexDirection="column" marginTop={1}>
        {props.spec.lines.map((line) => <SpanLine spans={line} theme={props.theme} />)}
      </box>
      <text fg={colorFor(props.theme, "dim")}>esc to close</text>
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
