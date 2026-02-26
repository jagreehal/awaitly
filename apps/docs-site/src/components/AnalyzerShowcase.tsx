"use client";

import { useState, useEffect } from "react";
import MermaidDiagram from "./MermaidDiagram";
import { createHighlighter } from "shiki";

let highlighterPromise: ReturnType<typeof createHighlighter> | null = null;
function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["github-light", "github-dark"],
      langs: ["typescript"],
    });
  }
  return highlighterPromise;
}

function HighlightedCode({ code }: { code: string }) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    getHighlighter()
      .then((highlighter) => {
        if (cancelled) return;
        const isDark =
          typeof document !== "undefined" &&
          document.documentElement.getAttribute("data-theme") === "dark";
        const theme = isDark ? "github-dark" : "github-light";
        setHtml(
          highlighter.codeToHtml(code, {
            lang: "typescript",
            theme,
          })
        );
      })
      .catch(() => setHtml(null));
    return () => {
      cancelled = true;
    };
  }, [code]);
  if (html === null) {
    return (
      <pre className="m-0 overflow-x-auto p-4 text-sm leading-relaxed bg-muted text-foreground">
        <code className="font-mono">{code}</code>
      </pre>
    );
  }
  return (
    <div
      className="analyzer-showcase-code overflow-x-auto [&_pre]:m-0 [&_pre]:p-4 [&_pre]:text-sm [&_pre]:leading-relaxed [&_pre]:whitespace-pre [&_pre]:min-w-max"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export interface ShowcaseEntry {
  title: string;
  code: string;
  mermaid: string;
  stepDetails?: Array<{
    stepId?: string;
    name?: string;
    callee?: string;
    depSource?: string;
    errors?: string[];
    outputType?: string;
    outputTypeKind?: "inferred" | "declared" | "unknown";
    outputTypeDisplay?: string;
    outputTypeText?: string;
    errorTypeDisplay?: string;
    retry?: { attempts?: number; backoff?: string };
    timeout?: { ms?: number };
    repeats?: string;
    loopType?: string;
    iterationSource?: string;
    kind?: string;
    acquire?: string;
    use?: string;
    release?: string;
    stepKind?: string;
    try?: boolean;
    compensate?: boolean;
  }>;
}

interface AnalyzerShowcaseProps {
  entries: ShowcaseEntry[];
}

function slug(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

type Tab = "diagram" | "source";

/* ── Diagram icon ── */
const DiagramIcon = () => (
  <svg
    className="h-4 w-4"
    aria-hidden="true"
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    fill="none"
    viewBox="0 0 24 24"
  >
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      d="M9.143 4H4.857A.857.857 0 0 0 4 4.857v4.286c0 .473.384.857.857.857h4.286A.857.857 0 0 0 10 9.143V4.857A.857.857 0 0 0 9.143 4Zm10 0h-4.286a.857.857 0 0 0-.857.857v4.286c0 .473.384.857.857.857h4.286A.857.857 0 0 0 20 9.143V4.857A.857.857 0 0 0 19.143 4Zm-10 10H4.857a.857.857 0 0 0-.857.857v4.286c0 .473.384.857.857.857h4.286a.857.857 0 0 0 .857-.857v-4.286A.857.857 0 0 0 9.143 14Zm10 0h-4.286a.857.857 0 0 0-.857.857v4.286c0 .473.384.857.857.857h4.286a.857.857 0 0 0 .857-.857v-4.286a.857.857 0 0 0-.857-.857Z"
    />
  </svg>
);

/* ── Code icon ── */
const CodeIcon = () => (
  <svg
    className="h-4 w-4"
    aria-hidden="true"
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    fill="none"
    viewBox="0 0 24 24"
  >
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      d="m8 8-4 4 4 4m8 0 4-4-4-4m-2-3-4 14"
    />
  </svg>
);

function StepBadge({
  label,
  variant,
}: {
  label: string;
  variant: "blue" | "amber" | "green" | "red" | "purple" | "gray";
}) {
  const colors = {
    blue: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/25",
    amber:
      "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/25",
    green:
      "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/25",
    red: "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/25",
    purple:
      "bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/25",
    gray: "bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20",
  };
  return (
    <span
      className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${colors[variant]}`}
    >
      {label}
    </span>
  );
}

function StepDetailsCard({
  steps,
}: {
  steps: NonNullable<ShowcaseEntry["stepDetails"]>;
}) {
  return (
    <div className="space-y-2">
      {steps.map((step, i) => {
        const errors = Array.isArray(step.errors) ? step.errors : [];
        const outputType =
          step.outputTypeText ?? step.outputTypeDisplay ?? step.outputType;
        const errorType = step.errorTypeDisplay;
        const retryInfo = step.retry
          ? `${step.retry.attempts ?? "?"}${step.retry.backoff ? ` ${step.retry.backoff}` : ""}`
          : null;
        const timeoutInfo = step.timeout
          ? `${step.timeout.ms ?? "?"}ms`
          : null;
        const loopInfo =
          step.repeats === "loop"
            ? step.iterationSource ?? step.loopType ?? "loop"
            : null;
        const resourceOps =
          step.kind === "resource"
            ? [step.acquire, step.use, step.release].filter(Boolean)
            : [];

        return (
          <div
            key={i}
            className="flex flex-wrap items-start gap-x-4 gap-y-1.5 rounded-lg border border-[var(--sl-color-gray-5)] bg-[var(--sl-color-gray-7,transparent)] px-3 py-2.5 text-xs"
          >
            <div className="flex items-center gap-2">
              <code className="font-mono font-bold text-[var(--sl-color-white)]">
                {String(step.stepId ?? step.name ?? "")}
              </code>
              {step.callee && (
                <span className="font-mono text-[var(--sl-color-gray-3)]">
                  {step.callee}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {step.depSource && (
                <StepBadge label={`dep: ${step.depSource}`} variant="gray" />
              )}
              {step.stepKind && !["step"].includes(step.stepKind) && (
                <StepBadge label={step.stepKind} variant="purple" />
              )}
              {step.compensate && (
                <StepBadge label="compensable" variant="green" />
              )}
              {step.try && <StepBadge label="try" variant="amber" />}
              {errors.map((e) => (
                <StepBadge key={e} label={e} variant="red" />
              ))}
              {retryInfo && (
                <StepBadge label={`retry: ${retryInfo}`} variant="amber" />
              )}
              {timeoutInfo && (
                <StepBadge label={`timeout: ${timeoutInfo}`} variant="amber" />
              )}
              {loopInfo && (
                <StepBadge label={`loop: ${loopInfo}`} variant="purple" />
              )}
              {outputType && outputType !== "any" && outputType !== "void" && (
                <StepBadge label={`→ ${outputType}`} variant="blue" />
              )}
              {errorType && errorType !== "never" && (
                <StepBadge label={`err: ${errorType}`} variant="red" />
              )}
              {resourceOps.length > 0 && (
                <StepBadge
                  label={resourceOps.join(" → ")}
                  variant="green"
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ShowcaseEntryCard({ entry }: { entry: ShowcaseEntry }) {
  const [tab, setTab] = useState<Tab>("diagram");

  return (
    <section className="relative">
      {/* Header */}
      <h2
        id={slug(entry.title)}
        className="!mt-0 mb-3 flex items-center gap-3 text-xl font-bold tracking-tight"
      >
        <span className="inline-block h-5 w-1 rounded-full bg-[var(--sl-color-accent)]" />
        {entry.title}
      </h2>

      {/* Tabbed container */}
      <div className="overflow-hidden rounded-lg border border-[var(--sl-color-gray-5)]">
        {/* Tab bar */}
        <div className="border-b border-[var(--sl-color-gray-5)]">
          <div className="flex gap-2 px-1">
            <button
              type="button"
              onClick={() => setTab("diagram")}
              className={[
                "m-0 relative inline-flex items-center gap-2 px-4 py-3 text-sm font-medium",
                "text-[var(--sl-color-gray-3)] hover:text-[var(--sl-color-gray-2)]",
                "after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:rounded-full after:content-['']",
                tab === "diagram"
                  ? "text-[var(--sl-color-accent)] after:bg-[var(--sl-color-accent)]"
                  : "after:bg-transparent",
              ].join(" ")}
            >
              <DiagramIcon />
              Diagram
            </button>

            <button
              type="button"
              onClick={() => setTab("source")}
              className={[
                "m-0 mt-0! relative inline-flex items-center gap-2 px-4 py-3 text-sm font-medium",
                "text-[var(--sl-color-gray-3)] hover:text-[var(--sl-color-gray-2)]",
                "after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:rounded-full after:content-['']",
                tab === "source"
                  ? "text-[var(--sl-color-accent)] after:bg-[var(--sl-color-accent)]"
                  : "after:bg-transparent",
              ].join(" ")}
            >
              <CodeIcon />
              Source
            </button>
          </div>
        </div>

        {/* Tab content */}
        {tab === "diagram" && (
          <MermaidDiagram code={entry.mermaid} className="min-h-[200px]!" />
        )}
        {tab === "source" && <HighlightedCode code={entry.code} />}
      </div>

      {/* Step details */}
      {entry.stepDetails && entry.stepDetails.length > 0 && (
        <details className="group mt-3">
          <summary className="flex cursor-pointer select-none items-center gap-2 text-sm font-medium text-[var(--sl-color-gray-2)]">
            {`${entry.stepDetails.length} step${entry.stepDetails.length !== 1 ? "s" : ""} analyzed`}
          </summary>
          <div className="mt-3">
            <StepDetailsCard steps={entry.stepDetails} />
          </div>
        </details>
      )}

      {/* Separator */}
      <div className="mt-8 border-b border-[var(--sl-color-gray-5)]" />
    </section>
  );
}

export default function AnalyzerShowcase({ entries }: AnalyzerShowcaseProps) {
  return (
    <div className="space-y-10">
      {entries.map((entry) => (
        <ShowcaseEntryCard key={entry.title} entry={entry} />
      ))}
    </div>
  );
}
