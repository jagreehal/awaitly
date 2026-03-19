export type StepChangeKind =
  | "added"
  | "removed"
  | "unchanged"
  | "renamed"
  | "moved";

export interface StepDiffEntry {
  kind: StepChangeKind;
  stepId: string;
  /** Previous step ID — only populated for "renamed" entries */
  previousStepId?: string;
  callee?: string;
  /** Container type in the before IR — only for "moved" entries */
  containerBefore?: string;
  /** Container type in the after IR — only for "moved" entries */
  containerAfter?: string;
}

export interface StructuralChange {
  kind: "added" | "removed";
  nodeType: string;
  description: string;
}

export interface DiffSummary {
  stepsAdded: number;
  stepsRemoved: number;
  stepsRenamed: number;
  stepsMoved: number;
  stepsUnchanged: number;
  structuralChanges: number;
  hasRegressions: boolean;
}

export interface WorkflowDiff {
  beforeName: string;
  afterName: string;
  diffedAt: number;
  steps: StepDiffEntry[];
  structuralChanges: StructuralChange[];
  summary: DiffSummary;
}

export interface DiffOptions {
  /** Whether to detect renamed steps by matching callee + position. Default: true */
  detectRenames?: boolean;
  /** Whether to flag step removals as regressions. Default: false */
  regressionMode?: boolean;
}

export interface DiffMarkdownOptions {
  /** Whether to include unchanged steps in the output. Default: true */
  showUnchanged?: boolean;
  title?: string;
}

export interface DiffMermaidOptions {
  /** Whether to show removed steps in the diagram. Default: true */
  showRemovedSteps?: boolean;
  direction?: "TD" | "TB" | "LR" | "BT" | "RL";
}
