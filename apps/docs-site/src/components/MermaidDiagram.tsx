"use client";

import { useEffect, useRef, useState } from "react";

interface MermaidDiagramProps {
  code: string;
  className?: string;
}

/**
 * Renders a Mermaid diagram from a code string (client-side).
 * Used by the analyzer showcase page for dynamic diagrams.
 */
export default function MermaidDiagram({ code, className = "" }: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current || !code.trim()) return;
    let cancelled = false;
    setError(null);
    const run = async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "neutral",
          securityLevel: "loose",
          flowchart: { htmlLabels: true, curve: "basis" },
        });
        const id = `mermaid-${Math.random().toString(36).slice(2, 9)}`;
        const { svg } = await mermaid.render(id, code);
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (error) {
    return (
      <div className={`rounded-lg border border-red-400/30 bg-red-50 p-4 text-sm dark:bg-red-950/20 ${className}`}>
        <div className="mb-1 flex items-center gap-2 font-semibold text-red-700 dark:text-red-400">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
          </svg>
          Mermaid render error
        </div>
        <pre className="mt-2 whitespace-pre-wrap text-xs text-red-600 dark:text-red-400/80">{error}</pre>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`flex min-h-[120px] items-center justify-center overflow-x-auto bg-white p-4 [&_svg]:max-w-full ${className}`}
    />
  );
}
