/**
 * WorkflowPlayground - Interactive workflow visualization
 *
 * Two-pane layout: CodeMirror editor on left, live Mermaid diagram on right.
 * Analyzes workflow code in real-time using awaitly-analyze/browser.
 */

import { useEffect, useRef, useState, useCallback } from 'preact/hooks';
import type { FunctionalComponent } from 'preact';

// Default example workflow code
const DEFAULT_CODE = `import { run } from 'awaitly/run';

await run(async (step) => {
  // Fetch user data
  const user = await step(() => fetchUser(userId));

  // Fetch profile and settings in parallel
  const [profile, settings] = await step.parallel({
    profile: () => fetchProfile(user.id),
    settings: () => fetchSettings(user.id),
  });

  // Conditional premium check
  if (user.isPremium) {
    await step(() => loadPremiumFeatures());
  }

  return { user, profile, settings };
});
`;

interface Props {
  /** Initial code to display in the editor */
  initialCode?: string;
  /** Height of the playground (default: 500px) */
  height?: string;
  /** Whether to show the code editor (default: true) */
  showEditor?: boolean;
  /** Debounce delay in ms (default: 300) */
  debounceMs?: number;
}

interface AnalysisState {
  status: 'idle' | 'loading' | 'analyzing' | 'success' | 'error';
  diagram?: string;
  error?: string;
}

const WorkflowPlayground: FunctionalComponent<Props> = ({
  initialCode = DEFAULT_CODE,
  height = '500px',
  showEditor = true,
  debounceMs = 300,
}) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const diagramRef = useRef<HTMLDivElement>(null);
  const editorViewRef = useRef<any>(null);
  const [code, setCode] = useState(initialCode);
  const [state, setState] = useState<AnalysisState>({ status: 'loading' });
  const [editorLoaded, setEditorLoaded] = useState(false);
  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const analyzerRef = useRef<typeof import('awaitly-analyze/browser') | null>(null);
  const mermaidRef = useRef<typeof import('mermaid').default | null>(null);

  // Initialize CodeMirror
  useEffect(() => {
    if (!showEditor || !editorRef.current || editorViewRef.current) return;

    let mounted = true;

    const initEditor = async () => {
      const { EditorView, basicSetup } = await import('codemirror');
      const { javascript } = await import('@codemirror/lang-javascript');
      const { oneDark } = await import('@codemirror/theme-one-dark');

      if (!mounted || !editorRef.current) return;

      const view = new EditorView({
        doc: code,
        extensions: [
          basicSetup,
          javascript({ typescript: true }),
          oneDark,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              setCode(update.state.doc.toString());
            }
          }),
          EditorView.theme({
            '&': { height: '100%', fontSize: '14px' },
            '.cm-scroller': { overflow: 'auto' },
            '.cm-content': { fontFamily: 'var(--sl-font-mono, monospace)' },
          }),
        ],
        parent: editorRef.current,
      });

      editorViewRef.current = view;
      setEditorLoaded(true);
    };

    initEditor();

    return () => {
      mounted = false;
      if (editorViewRef.current) {
        editorViewRef.current.destroy();
        editorViewRef.current = null;
      }
    };
  }, [showEditor]);

  // Initialize analyzer and mermaid
  useEffect(() => {
    let mounted = true;

    const initModules = async () => {
      try {
        // Load analyzer module
        const analyzer = await import('awaitly-analyze/browser');

        // Configure WASM path based on base URL
        const base = document.querySelector('base')?.href || '/';
        analyzer.setWasmBasePath(`${base}wasm/`);

        if (!mounted) return;
        analyzerRef.current = analyzer;

        // Load mermaid
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: 'base',
          themeVariables: {
            // Dark background for the diagram
            background: '#1e293b',
            // Primary text color - dark for readability
            primaryTextColor: '#1e293b',
            secondaryTextColor: '#1e293b',
            tertiaryTextColor: '#1e293b',
            // Node colors
            primaryColor: '#e1f5fe',
            primaryBorderColor: '#01579b',
            secondaryColor: '#e8f5e9',
            secondaryBorderColor: '#1b5e20',
            tertiaryColor: '#fff3e0',
            tertiaryBorderColor: '#e65100',
            // Lines
            lineColor: '#64748b',
            // General text - must be dark
            textColor: '#1e293b',
            // Node text specifically
            nodeTextColor: '#1e293b',
            // Flowchart specific
            clusterBkg: '#334155',
            clusterBorder: '#475569',
            defaultLinkColor: '#64748b',
            titleColor: '#f1f5f9',
            // Edge labels
            edgeLabelBackground: '#475569',
          },
        });

        if (!mounted) return;
        mermaidRef.current = mermaid;

        setState({ status: 'idle' });
      } catch (err) {
        if (!mounted) return;
        setState({
          status: 'error',
          error: `Failed to initialize: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    };

    initModules();

    return () => {
      mounted = false;
    };
  }, []);

  // Analyze code with debounce
  const analyzeCode = useCallback(async (sourceCode: string) => {
    if (!analyzerRef.current || !mermaidRef.current) {
      return;
    }

    setState((prev) => ({ ...prev, status: 'analyzing' }));

    try {
      // Reset ID counter for consistent IDs
      analyzerRef.current.resetIdCounter();

      // Analyze the source code
      const results = await analyzerRef.current.analyzeWorkflowSource(sourceCode, {
        assumeImported: true, // Doc snippets don't need explicit imports
      });

      if (results.length === 0) {
        setState({
          status: 'error',
          error: 'No workflow found. Make sure your code contains a run() or createWorkflow() call.',
        });
        return;
      }

      // Render to Mermaid
      const diagram = analyzerRef.current.renderStaticMermaid(results[0]);

      setState({ status: 'success', diagram });
    } catch (err) {
      setState({
        status: 'error',
        error: `Analysis failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }, []);

  // Debounced analysis on code change
  useEffect(() => {
    if (state.status === 'loading') return;

    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    debounceTimeoutRef.current = setTimeout(() => {
      analyzeCode(code);
    }, debounceMs);

    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, [code, state.status, analyzeCode, debounceMs]);

  // Render Mermaid diagram
  useEffect(() => {
    if (!diagramRef.current || !mermaidRef.current || !state.diagram) return;

    const renderDiagram = async () => {
      try {
        // Clear previous diagram
        diagramRef.current!.textContent = '';

        // Generate unique ID for this render
        const id = `mermaid-${Date.now()}`;

        // Render the diagram - Mermaid generates safe SVG from our structured data
        // The diagram content is generated from our own analyzer output, not user input
        const { svg } = await mermaidRef.current!.render(id, state.diagram!);

        // Create a container element and set the SVG
        // Note: Mermaid's render() returns sanitized SVG from our structured data
        const container = document.createElement('div');
        container.innerHTML = svg;
        diagramRef.current!.appendChild(container);
      } catch (err) {
        console.error('Mermaid render error:', err);
        const errorContainer = document.createElement('div');
        errorContainer.className = 'playground-error';
        const errorP = document.createElement('p');
        errorP.textContent = 'Failed to render diagram';
        const errorPre = document.createElement('pre');
        errorPre.textContent = state.diagram || '';
        errorContainer.appendChild(errorP);
        errorContainer.appendChild(errorPre);
        diagramRef.current!.appendChild(errorContainer);
      }
    };

    renderDiagram();
  }, [state.diagram]);

  return (
    <div class="playground-container" style={{ height }}>
      {showEditor && (
        <div class="playground-editor">
          <div class="playground-header">
            <span class="playground-title">Workflow Code</span>
            <span class="playground-hint">Edit to see live updates</span>
          </div>
          <div class="playground-editor-content" ref={editorRef}>
            {/* Fallback if CodeMirror doesn't load */}
            {!editorLoaded && (
              <pre class="playground-fallback-code">{code}</pre>
            )}
          </div>
        </div>
      )}

      <div class="playground-diagram">
        <div class="playground-header">
          <span class="playground-title">Workflow Diagram</span>
          {state.status === 'analyzing' && (
            <span class="playground-status">Analyzing...</span>
          )}
        </div>
        <div class="playground-diagram-content" ref={diagramRef}>
          {state.status === 'loading' && (
            <div class="playground-loading">
              <div class="playground-spinner" />
              <p>Loading analyzer...</p>
            </div>
          )}
          {state.status === 'error' && (
            <div class="playground-error">
              <p>{state.error}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default WorkflowPlayground;
