import type { KindSpec } from "../../core/registry.js";

export const agentKind: KindSpec = {
  id: "agent",
  description: "Specialized agent and subagent definitions.",
  detect: (rel) => rel.startsWith("agents/") && rel.endsWith(".md"),
  layout: "file",
  defaultTargets: {},
};
