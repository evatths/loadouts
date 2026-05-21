import * as path from "node:path";
import { parseMarkdownFrontmatter } from "./config.js";
import { estimateTokens } from "./tokens.js";
import { fileExists, hashContent, isDirectory, readFile } from "../lib/fs.js";
import type { ResolvedItem, ResolvedLoadout, Tool } from "./types.js";

export const RUNTIME_SCHEMA_VERSION = 1 as const;

export type RuntimeSupportedKind = "instruction" | "rule" | "skill";
export type RuntimeMode = "native-runtime" | "experimental-runtime" | "filesystem-activation";

export interface RuntimeCapabilities {
  runtimeMode: RuntimeMode;
  modelInjection: {
    instructions: boolean;
    rules: boolean;
  };
  skillPathDiscovery: boolean;
  nativeSkillHotSwap: boolean;
  supportedKinds: RuntimeSupportedKind[];
}

export interface RuntimeDiagnostic {
  code: "unsupported-kind" | "unreadable-source" | "missing-skill-entry";
  severity: "warning";
  message: string;
  kind: string;
  relativePath: string;
  sourcePath: string;
}

interface RuntimeComponentBase {
  loadout: string;
  kind: RuntimeSupportedKind;
  relativePath: string;
  sourcePath: string;
  tokenEstimate: number;
  contentHash: string;
}

export interface RuntimeTextComponent extends RuntimeComponentBase {
  kind: "instruction" | "rule";
  content: string;
}

export interface RuntimeSkillComponent extends RuntimeComponentBase {
  kind: "skill";
}

export type RuntimeComponent = RuntimeTextComponent | RuntimeSkillComponent;

export interface RuntimeTextInjection {
  loadout: string;
  relativePath: string;
  sourcePath: string;
  tokenEstimate: number;
  contentHash: string;
  content: string;
}

export interface RuntimeSkillRef {
  loadout: string;
  name: string;
  description?: string;
  path: string;
  sourcePath: string;
}

export interface RuntimeBundle {
  schemaVersion: 1;
  tool: Tool;
  loadouts: Array<{
    name: string;
    description?: string;
    rootPath: string;
  }>;
  fingerprint: string;
  generatedAt: string;
  components: RuntimeComponent[];
  injection: {
    instructions: RuntimeTextInjection[];
    rules: RuntimeTextInjection[];
    skills: RuntimeSkillRef[];
  };
  diagnostics: RuntimeDiagnostic[];
  capabilities: RuntimeCapabilities;
}

export interface CompileRuntimeBundleOptions {
  generatedAt?: string;
}

const RUNTIME_CAPABILITY_MATRIX: Record<string, RuntimeCapabilities> = {
  opencode: {
    runtimeMode: "experimental-runtime",
    modelInjection: {
      instructions: true,
      rules: true,
    },
    skillPathDiscovery: true,
    nativeSkillHotSwap: false,
    supportedKinds: ["instruction", "rule", "skill"],
  },
  pi: {
    runtimeMode: "native-runtime",
    modelInjection: {
      instructions: true,
      rules: true,
    },
    skillPathDiscovery: true,
    nativeSkillHotSwap: false,
    supportedKinds: ["instruction", "rule", "skill"],
  },
  codex: {
    runtimeMode: "experimental-runtime",
    modelInjection: {
      instructions: true,
      rules: true,
    },
    skillPathDiscovery: true,
    nativeSkillHotSwap: false,
    supportedKinds: ["instruction", "rule", "skill"],
  },
  "claude-code": {
    runtimeMode: "filesystem-activation",
    modelInjection: {
      instructions: false,
      rules: false,
    },
    skillPathDiscovery: false,
    nativeSkillHotSwap: false,
    supportedKinds: ["instruction", "rule", "skill"],
  },
  cursor: {
    runtimeMode: "filesystem-activation",
    modelInjection: {
      instructions: false,
      rules: false,
    },
    skillPathDiscovery: false,
    nativeSkillHotSwap: false,
    supportedKinds: ["instruction", "rule", "skill"],
  },
};

export function compileRuntimeBundle(
  tool: Tool,
  resolved: ResolvedLoadout | ResolvedLoadout[],
  options: CompileRuntimeBundleOptions = {}
): RuntimeBundle {
  const loadouts = Array.isArray(resolved) ? resolved : [resolved];
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const components: RuntimeComponent[] = [];
  const diagnostics: RuntimeDiagnostic[] = [];

  for (const loadout of loadouts) {
    for (const item of loadout.items) {
      if (!item.tools.includes(tool)) continue;

      if (item.kind === "instruction" || item.kind === "rule") {
        const textComponent = compileTextComponent(loadout.name, item as ResolvedItem & {
          kind: "instruction" | "rule";
        });
        if ("diagnostic" in textComponent) {
          diagnostics.push(textComponent.diagnostic);
        } else {
          components.push(textComponent.component);
        }
        continue;
      }

      if (item.kind === "skill") {
        const skillComponent = compileSkillComponent(loadout.name, item as ResolvedItem & {
          kind: "skill";
        });
        if ("diagnostic" in skillComponent) {
          diagnostics.push(skillComponent.diagnostic);
        } else {
          components.push(skillComponent.component);
        }
        continue;
      }

      diagnostics.push({
        code: "unsupported-kind",
        severity: "warning",
        message: `Runtime v1 ignores unsupported artifact kind \"${item.kind}\".`,
        kind: item.kind,
        relativePath: item.relativePath,
        sourcePath: item.sourcePath,
      });
    }
  }

  // Preserve resolver order. Runtime injection is semantic context, not a file
  // manifest; changing loadout/include order should change the fingerprint.
  const orderedComponents = components;
  const orderedDiagnostics = diagnostics;

  const injection = buildInjectionBuckets(orderedComponents);

  const capabilities = buildRuntimeCapabilities(tool);

  const runtimeLoadouts = loadouts.map((loadout) => ({
    name: loadout.name,
    description: loadout.description,
    rootPath: loadout.rootPath,
  }));

  const fingerprint = hashContent(
    stableStringify({
      schemaVersion: RUNTIME_SCHEMA_VERSION,
      tool,
      loadouts: runtimeLoadouts,
      components: orderedComponents,
      injection,
      diagnostics: orderedDiagnostics,
      capabilities,
    })
  );

  return {
    schemaVersion: RUNTIME_SCHEMA_VERSION,
    tool,
    loadouts: runtimeLoadouts,
    fingerprint,
    generatedAt,
    components: orderedComponents,
    injection,
    diagnostics: orderedDiagnostics,
    capabilities,
  };
}

function buildRuntimeCapabilities(tool: Tool): RuntimeCapabilities {
  const toolCapabilities = RUNTIME_CAPABILITY_MATRIX[tool];
  if (toolCapabilities) return toolCapabilities;

  return {
    runtimeMode: "filesystem-activation",
    modelInjection: {
      instructions: false,
      rules: false,
    },
    skillPathDiscovery: false,
    nativeSkillHotSwap: false,
    supportedKinds: ["instruction", "rule", "skill"],
  };
}

export function renderRuntimeSystemBlock(bundle: RuntimeBundle): string {
  const lines: string[] = [];
  const instructionLabel = bundle.capabilities.modelInjection.instructions
    ? "Instructions (Model Injection Ready)"
    : "Instructions (Compiled)";
  const ruleLabel = bundle.capabilities.modelInjection.rules
    ? "Rules (Model Injection Ready)"
    : "Rules (Compiled)";

  lines.push("[loadout-runtime:v1]");
  lines.push(`tool: ${bundle.tool}`);
  lines.push(`fingerprint: ${bundle.fingerprint}`);
  lines.push(`generatedAt: ${bundle.generatedAt}`);
  lines.push(`loadouts: ${bundle.loadouts.map((l) => l.name).join(", ") || "(none)"}`);
  lines.push(
    `capabilities: mode=${bundle.capabilities.runtimeMode}, instructionInjection=${bundle.capabilities.modelInjection.instructions}, ruleInjection=${bundle.capabilities.modelInjection.rules}, skillPathDiscovery=${bundle.capabilities.skillPathDiscovery}, nativeSkillHotSwap=${bundle.capabilities.nativeSkillHotSwap}`
  );
  lines.push("");

  lines.push(`## ${instructionLabel}`);
  if (bundle.injection.instructions.length === 0) {
    lines.push("(none)");
  } else {
    for (const item of bundle.injection.instructions) {
      lines.push(`### ${item.relativePath}`);
      lines.push(item.content);
      lines.push("");
    }
  }

  lines.push(`## ${ruleLabel}`);
  if (bundle.injection.rules.length === 0) {
    lines.push("(none)");
  } else {
    for (const item of bundle.injection.rules) {
      lines.push(`### ${item.relativePath}`);
      lines.push(item.content);
      lines.push("");
    }
  }

  lines.push("## Skills (Path Discovery Only)");
  lines.push("These are references for discovery. Native skill hot-swap is disabled in runtime v1.");
  if (bundle.injection.skills.length === 0) {
    lines.push("(none)");
  } else {
    for (const skill of bundle.injection.skills) {
      const description = skill.description ? ` - ${skill.description}` : "";
      lines.push(`- ${skill.name}${description}`);
      lines.push(`  path: ${skill.path}`);
      lines.push(`  sourcePath: ${skill.sourcePath}`);
    }
  }

  if (bundle.diagnostics.length > 0) {
    lines.push("");
    lines.push("## Diagnostics");
    for (const diagnostic of bundle.diagnostics) {
      lines.push(`- [${diagnostic.code}] ${diagnostic.message} (${diagnostic.relativePath})`);
    }
  }

  return lines.join("\n").trimEnd() + "\n";
}

function compileTextComponent(
  loadoutName: string,
  item: ResolvedItem & { kind: "instruction" | "rule" }
):
  | { component: RuntimeTextComponent }
  | { diagnostic: RuntimeDiagnostic } {
  try {
    const content = readFile(item.sourcePath);
    return {
      component: {
        loadout: loadoutName,
        kind: item.kind,
        relativePath: item.relativePath,
        sourcePath: item.sourcePath,
        tokenEstimate: estimateTokens(content),
        contentHash: hashContent(content),
        content,
      },
    };
  } catch {
    return {
      diagnostic: {
        code: "unreadable-source",
        severity: "warning",
        message: "Runtime v1 could not read artifact source.",
        kind: item.kind,
        relativePath: item.relativePath,
        sourcePath: item.sourcePath,
      },
    };
  }
}

function compileSkillComponent(
  loadoutName: string,
  item: ResolvedItem & { kind: "skill" }
):
  | { component: RuntimeSkillComponent }
  | { diagnostic: RuntimeDiagnostic } {
  const skillEntryPath = resolveSkillEntryPath(item.sourcePath);
  if (!skillEntryPath || !fileExists(skillEntryPath)) {
    return {
      diagnostic: {
        code: "missing-skill-entry",
        severity: "warning",
        message: "Runtime v1 expected a SKILL.md entrypoint for skill discovery.",
        kind: item.kind,
        relativePath: item.relativePath,
        sourcePath: item.sourcePath,
      },
    };
  }

  try {
    const content = readFile(skillEntryPath);
    return {
      component: {
        loadout: loadoutName,
        kind: "skill",
        relativePath: item.relativePath,
        sourcePath: item.sourcePath,
        tokenEstimate: estimateTokens(content),
        contentHash: hashContent(content),
      },
    };
  } catch {
    return {
      diagnostic: {
        code: "unreadable-source",
        severity: "warning",
        message: "Runtime v1 could not read artifact source.",
        kind: item.kind,
        relativePath: item.relativePath,
        sourcePath: item.sourcePath,
      },
    };
  }
}

function resolveSkillEntryPath(sourcePath: string): string {
  if (isDirectory(sourcePath)) {
    return path.join(sourcePath, "SKILL.md");
  }

  return sourcePath;
}

function buildInjectionBuckets(components: RuntimeComponent[]): RuntimeBundle["injection"] {
  const instructions: RuntimeTextInjection[] = [];
  const rules: RuntimeTextInjection[] = [];
  const skills: RuntimeSkillRef[] = [];

  for (const component of components) {
    if (component.kind === "instruction" || component.kind === "rule") {
      const block: RuntimeTextInjection = {
        loadout: component.loadout,
        relativePath: component.relativePath,
        sourcePath: component.sourcePath,
        tokenEstimate: component.tokenEstimate,
        contentHash: component.contentHash,
        content: component.content,
      };

      if (component.kind === "instruction") {
        instructions.push(block);
      } else {
        rules.push(block);
      }
      continue;
    }

    if (component.kind === "skill") {
      skills.push(createSkillRef(component));
    }
  }

  return { instructions, rules, skills };
}

function createSkillRef(component: RuntimeSkillComponent): RuntimeSkillRef {
  const skillEntryPath = resolveSkillEntryPath(component.sourcePath);
  let name = path.basename(component.relativePath);
  let description: string | undefined;

  if (fileExists(skillEntryPath)) {
    try {
      const parsed = parseMarkdownFrontmatter(readFile(skillEntryPath));
      if (typeof parsed.frontmatter.name === "string" && parsed.frontmatter.name.trim().length > 0) {
        name = parsed.frontmatter.name;
      }
      if (
        typeof parsed.frontmatter.description === "string"
        && parsed.frontmatter.description.trim().length > 0
      ) {
        description = parsed.frontmatter.description;
      }
    } catch {
      // Best-effort metadata extraction only.
    }
  }

  return {
    loadout: component.loadout,
    name,
    description,
    path: component.relativePath,
    sourcePath: component.sourcePath,
  };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    const keys = Object.keys(object).sort((a, b) => a.localeCompare(b));
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}
