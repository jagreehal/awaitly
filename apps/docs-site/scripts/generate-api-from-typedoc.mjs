#!/usr/bin/env node
/**
 * Reads TypeDoc JSON and generates Starlight-compatible API reference markdown.
 * Run from repo root: node apps/docs-site/scripts/generate-api-from-typedoc.mjs
 * Or from apps/docs-site: node scripts/generate-api-from-typedoc.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_JSON_PATH = join(__dirname, "../.typedoc-out/api.json");
const DEFAULT_OUT_PATH = join(__dirname, "../src/content/docs/reference/api.md");

// Map symbol names to section (section title, subsection or null)
const SECTION_MAP = {
  // Results
  ok: ["Results", "Constructors"],
  err: ["Results", "Constructors"],
  isOk: ["Results", "Type guards"],
  isErr: ["Results", "Type guards"],
  isUnexpectedError: ["Results", "Type guards"],
  isWorkflowCancelled: ["Results", "Type guards"],
  // Unwrap
  unwrap: ["Unwrap", null],
  unwrapOr: ["Unwrap", null],
  unwrapOrElse: ["Unwrap", null],
  // Wrap
  from: ["Wrap", null],
  fromPromise: ["Wrap", null],
  tryAsync: ["Wrap", null],
  fromNullable: ["Wrap", null],
  // Transform
  map: ["Transform", null],
  mapError: ["Transform", null],
  mapTry: ["Transform", null],
  mapErrorTry: ["Transform", null],
  andThen: ["Transform", null],
  orElse: ["Transform", null],
  match: ["Transform", null],
  tap: ["Transform", null],
  tapError: ["Transform", null],
  // Function Composition (main package now exports these from functional)
  pipe: ["Function Composition", "pipe"],
  flow: ["Function Composition", "flow"],
  compose: ["Function Composition", "compose"],
  identity: ["Function Composition", "identity"],
  R: ["Function Composition", "R"],
  recoverWith: ["Function Composition", "recoverWith"],
  getOrElse: ["Function Composition", "getOrElse"],
  getOrElseLazy: ["Function Composition", "getOrElseLazy"],
  mapAsync: ["Function Composition", "mapAsync"],
  flatMapAsync: ["Function Composition", "flatMapAsync"],
  tapAsync: ["Function Composition", "tapAsync"],
  tapErrorAsync: ["Function Composition", "tapErrorAsync"],
  race: ["Function Composition", "race"],
  traverse: ["Function Composition", "traverse"],
  traverseAsync: ["Function Composition", "traverseAsync"],
  traverseParallel: ["Function Composition", "traverseParallel"],
  bindDeps: ["Function Composition", "bindDeps"],
};

function typeToString(t, refs = new Map()) {
  if (!t) return "unknown";
  if (t.type === "intrinsic") return t.name || "unknown";
  if (t.type === "reference") {
    const name = t.name || (t.target && refs.get(t.target)?.name) || "unknown";
    const args = t.typeArguments?.map((a) => typeToString(a, refs)).filter(Boolean);
    return args?.length ? `${name}<${args.join(", ")}>` : name;
  }
  if (t.type === "union") return (t.types || []).map((u) => typeToString(u, refs)).join(" | ");
  if (t.type === "array" && t.elementType) return `${typeToString(t.elementType, refs)}[]`;
  if (t.type === "predicate") return `(value: ${typeToString(t.targetType, refs)}) => boolean`;
  if (t.type === "reflection" && t.declaration?.signatures?.[0]) {
    const sig = t.declaration.signatures[0];
    const params = (sig.parameters || []).map((p) => `${p.name}${p.flags?.isOptional ? "?" : ""}: ${typeToString(p.type, refs)}`).join(", ");
    const ret = typeToString(sig.type, refs);
    return `(${params}) => ${ret}`;
  }
  return "unknown";
}

function getCommentSummary(comment) {
  if (!comment?.summary) return "";
  return comment.summary.map((s) => (s.kind === "text" ? s.text : "")).join("").trim();
}

function getCommentRemarks(comment) {
  if (!comment?.blockTags?.length) return "";
  const remarks = comment.blockTags.filter((t) => t.tag === "@remarks" || t.tag === "remarks");
  if (!remarks.length) return "";
  return remarks
    .map((t) => (t.content || []).map((c) => (c.kind === "text" ? c.text : "")).join("").trim())
    .filter(Boolean)
    .join("\n\n");
}

function getFullComment(comment) {
  const summary = getCommentSummary(comment);
  const remarks = getCommentRemarks(comment);
  if (!summary && !remarks) return "";
  const full = !remarks ? summary : summary ? `${summary}\n\n${remarks}` : remarks;
  // TypeDoc sometimes attaches the module-level JSDoc to re-exports (e.g. from, fromNullable). Skip it.
  if (full && (full.includes("## Quick Start") || full.includes("## Entry Points"))) return "";
  // Fix truncated "over ." from JSDoc (e.g. "Prefer ... over result.ok" → "over ." when code is stripped)
  if (full && full.includes(" over .")) return full.replace(/\s+over \.?/g, ".");
  return full;
}

function buildSignature(ref, sig) {
  if (!sig) return ref.name + "()";
  const params = (sig.parameters || []).map((p) => {
    const typeStr = p.type ? typeToString(p.type) : "unknown";
    return `${p.name}${p.flags?.isOptional ? "?" : ""}: ${typeStr}`;
  });
  const ret = sig.type ? typeToString(sig.type) : "void";
  return `${ref.name}(${params.join(", ")}): ${ret}`;
}

function collectReflections(node, path = [], out = [], refsById = new Map()) {
  if (!node || typeof node !== "object") return out;
  refsById.set(node.id, node);
  const name = node.name;
  const kind = node.kind ?? node.variant;
  // Kind 64 = Function, 32 = Variable, 1024 = Property (for nested)
  const isExport = (kind === 64 || kind === 32) && name && !name.startsWith("_");
  const fullName = path.length ? [...path, name].join(".") : name;
  if (isExport && (node.comment || node.signatures?.length)) {
    const section = SECTION_MAP[name] || SECTION_MAP[fullName];
    if (section) {
      const comment = node.comment || node.signatures?.[0]?.comment;
      out.push({
        name: fullName,
        section: section[0],
        subsection: section[1],
        comment: getFullComment(comment),
        signature: node.signatures?.[0] ? buildSignature(node, node.signatures[0]) : null,
      });
    }
  }
  const children = node.children || [];
  const nextPath = (kind === 4 || kind === 128) && name ? [...path, name] : path; // 4 = Namespace, 128 = Class
  for (const c of children) {
    if (c && typeof c === "object") collectReflections(c, nextPath, out, refsById);
  }
  return out;
}

function groupBySection(reflections) {
  const bySection = new Map();
  for (const r of reflections) {
    const key = r.subsection ? `${r.section}::${r.subsection}` : r.section;
    if (!bySection.has(key)) bySection.set(key, []);
    bySection.get(key).push(r);
  }
  return bySection;
}

/** Dedupe by short name (e.g. "pipe" and "Awaitly.pipe" → one "pipe"). Prefer root export (no dot in original name). */
function dedupeByName(items) {
  const byShort = new Map();
  for (const r of items) {
    const short = r.name.split(".").pop();
    const existing = byShort.get(short);
    const isRoot = r.name.indexOf(".") === -1;
    if (!existing) {
      byShort.set(short, { ...r, name: short, _originalName: r.name });
    } else {
      const existingIsRoot = existing._originalName.indexOf(".") === -1;
      const prefer = existingIsRoot ? existing : isRoot ? r : existing;
      const other = prefer === existing ? r : existing;
      const merged = {
        ...prefer,
        name: short,
        _originalName: prefer._originalName ?? prefer.name,
        comment: prefer.comment || other.comment,
        signature: prefer.signature || other.signature,
      };
      byShort.set(short, merged);
    }
  }
  return [...byShort.values()].map(({ _originalName, ...r }) => ({ ...r, name: r.name }));
}

function generateMarkdown(project) {
  const reflections = collectReflections(project);
  const bySection = groupBySection(reflections);

  const sectionOrder = [
    "Results::Constructors",
    "Results::Type guards",
    "Unwrap",
    "Wrap",
    "Transform",
    "Function Composition::pipe",
    "Function Composition::flow",
    "Function Composition::compose",
    "Function Composition::identity",
    "Function Composition::R",
    "Function Composition::recoverWith",
    "Function Composition::getOrElse",
    "Function Composition::getOrElseLazy",
    "Function Composition::mapAsync",
    "Function Composition::flatMapAsync",
    "Function Composition::tapAsync",
    "Function Composition::tapErrorAsync",
    "Function Composition::race",
    "Function Composition::traverse",
    "Function Composition::traverseAsync",
    "Function Composition::traverseParallel",
    "Function Composition::bindDeps",
  ];

  const lines = [
    "---",
    "title: API Reference",
    "description: Complete API documentation (generated from TypeDoc)",
    "---",
    "",
    "This page is generated from the awaitly package JSDoc and TypeScript types. For workflow and step options, see [Options reference](#options-reference) below.",
    "",
    "## Import styles",
    "",
    "You can use **named exports** (tree-shake friendly) or the **Awaitly** namespace. For **minimal bundle** (Result types only, no namespace), use `awaitly/result`:",
    "",
    "```typescript",
    "// Minimal bundle: Result types only",
    "import { ok, err, map, andThen, type AsyncResult } from 'awaitly/result';",
    "",
    "// Full package: named exports",
    "import { ok, err, pipe, map, type AsyncResult } from 'awaitly';",
    "",
    "// Full package: Awaitly namespace (Effect-style single object)",
    "import { Awaitly } from 'awaitly';",
    "Awaitly.ok(1); Awaitly.err('E'); Awaitly.pipe(2, (n) => n * 2);",
    "```",
    "",
  ];

  let currentSection = null;
  let currentSubsection = null;
  for (const key of sectionOrder) {
    const items = bySection.get(key);
    if (!items?.length) continue;
    const [section, subsection] = key.includes("::") ? key.split("::") : [key, null];
    if (section !== currentSection) {
      lines.push(`## ${section}`);
      lines.push("");
      currentSection = section;
      currentSubsection = null;
    }
    if (subsection && subsection !== currentSubsection) {
      lines.push(`### ${subsection}`);
      lines.push("");
      currentSubsection = subsection;
    }
    const deduped = dedupeByName(items).sort((a, b) => a.name.localeCompare(b.name));
    for (const r of deduped) {
      if (!subsection || subsection !== r.name) {
        lines.push(`### ${r.name}`);
        lines.push("");
      }
      if (r.comment) {
        lines.push(r.comment);
        lines.push("");
      }
      if (r.signature) {
        lines.push("```typescript");
        lines.push(r.signature);
        lines.push("```");
        lines.push("");
      }
    }
  }

  // Append static Options reference (keep hand-maintained block)
  lines.push("## Options reference");
  lines.push("");
  lines.push("Single place for all workflow and step option keys (for docs and static analysis).");
  lines.push("");
  lines.push("**Workflow** — The value returned by `createWorkflow` has a single method: **`workflow.run(name?, fn, config?)`**. Overloads: `run(fn)`, `run(fn, config)`, `run(name, fn)`, `run(name, fn, config)`. Options below can be passed at **creation** (`createWorkflow('name', deps, options)`) or per-run in **RunConfig** (`workflow.run(fn, config)`).");
  lines.push("");
  lines.push("| Option | Type | Purpose |");
  lines.push("|--------|------|---------|");
  lines.push("| `description` | `string?` | Short description for labels/tooltips and doc generation |");
  lines.push("| `markdown` | `string?` | Full markdown documentation for static analysis and docs |");
  lines.push("| `strict` | `boolean?` | Closed error union |");
  lines.push("| `catchUnexpected` | `function?` | Map unexpected errors to typed union |");
  lines.push("| `onEvent` | `function?` | Event stream callback |");
  lines.push("| `createContext` | `function?` | Custom context factory |");
  lines.push("| `cache` | `StepCache?` | Step caching backend (creation-time only) |");
  lines.push("| `resumeState` | `ResumeState?` | Resume from saved state |");
  lines.push("| `deps` | `Partial<Deps>?` | Per-run override of creation-time deps (RunConfig only) |");
  lines.push("| `signal` | `AbortSignal?` | Workflow cancellation |");
  lines.push("| `streamStore` | `StreamStore?` | Streaming backend |");
  lines.push("| `snapshot` | `WorkflowSnapshot?` | Restore from saved snapshot (RunConfig or creation) |");
  lines.push("| `onUnknownSteps` | `'warn' | 'error' | 'ignore'?` | When snapshot has steps not in this run |");
  lines.push("| `onDefinitionChange` | `'warn' | 'error' | 'ignore'?` | When snapshot definition hash differs |");
  lines.push("");
  lines.push("**Persistence:** Use `createResumeStateCollector()`, pass `collector.handleEvent` to `onEvent`, then call `collector.getResumeState()` after a run to persist. Restore with `workflow.run(fn, { resumeState })` or creation-time `resumeState` (or `snapshot` where supported).");
  lines.push("");
  lines.push("**Step (step, step.sleep, step.retry, step.withTimeout)** — in options object:");
  lines.push("");
  lines.push("| Option | Type | Purpose |");
  lines.push("|--------|------|---------|");
  lines.push("| `name` | `string?` | Human-readable step name for tracing |");
  lines.push("| `key` | `string?` | Cache key for resume/caching |");
  lines.push("| `description` | `string?` | Short description for docs and static analysis |");
  lines.push("| `markdown` | `string?` | Full markdown for step documentation |");
  lines.push("| `ttl` | `number?` | Cache TTL (step.sleep and cached steps) |");
  lines.push("| `retry` | `object?` | Retry config (step.retry) |");
  lines.push("| `timeout` | `object?` | Timeout config (step.withTimeout) |");
  lines.push("| `signal` | `AbortSignal?` | Step cancellation (e.g. step.sleep) |");
  lines.push("");
  lines.push("**Saga step (saga.step / saga.tryStep)** — first argument is the step name (string). Optional third argument is an options object:");
  lines.push("");
  lines.push("| Option | Type | Purpose |");
  lines.push("|--------|------|---------|");
  lines.push("| `description` | `string?` | Short description for docs and static analysis |");
  lines.push("| `markdown` | `string?` | Full markdown for step documentation |");
  lines.push("| `compensate` | `function?` | Compensation function on rollback |");
  lines.push("");

  return lines.join("\n");
}

function main() {
  const jsonPath = process.argv[2] || DEFAULT_JSON_PATH;
  const outPath = process.argv[3] || DEFAULT_OUT_PATH;

  let project;
  try {
    const raw = readFileSync(jsonPath, "utf8");
    project = JSON.parse(raw);
  } catch (e) {
    console.error("Failed to read TypeDoc JSON:", jsonPath, e.message);
    process.exit(1);
  }

  const markdown = generateMarkdown(project);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, markdown, "utf8");
  console.log("Wrote", outPath);
}

main();
