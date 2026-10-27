/**
 * Types and constants shared by the Worker (agent) and the browser (React client).
 * Keep this file free of runtime dependencies on either side.
 */

export const MODELS = {
  "glm-5.3-flash": {
    id: "@cf/zai-org/glm-5.3-flash",
    label: "GLM-5.3 Flash",
    vendor: "Z.ai",
    note: "Multimodal, strong tool use",
  },
  "deepseek-v4-flash": {
    id: "@cf/deepseek-ai/deepseek-v4-flash-0731",
    label: "DeepSeek V4 Flash",
    vendor: "DeepSeek",
    note: "Fast, reasoning off",
  },
} as const;

export type ModelKey = keyof typeof MODELS;
export const DEFAULT_MODEL: ModelKey = "glm-5.3-flash";

export type Verdict = "allow" | "review" | "block" | "info";

/** One rendered row in a trace: a question/field and its answer, normalized for the UI. */
export type TraceRow =
  | { kind: "probability"; label: string; value: number; hint?: string }
  | {
      kind: "choice";
      label: string;
      choice: string;
      options: Record<string, number>;
    }
  | {
      kind: "value";
      label: string;
      value: string;
      confidence?: number;
      hint?: string;
    }
  | {
      kind: "interval";
      label: string;
      median: number;
      p10: number;
      p90: number;
      unit?: string;
    };

/** One System One call, as shown in the Decision Trace panel. */
export type DecisionTrace = {
  id: string;
  at: number;
  /** Which step this was, e.g. "Input firewall" or "IOC extraction". */
  step: string;
  modelId: string;
  latencyMs: number;
  inputTokens: number;
  costUsd: number;
  verdict?: Verdict;
  summary?: string;
  rows: TraceRow[];
  gatewayLogId?: string;
  /** Short preview of what was evaluated. */
  inputPreview?: string;
};

/** A piece of the original message; sensitive pieces carry their class and placeholder. */
export type ReportSegment = {
  text: string;
  cls?: string;
  placeholder?: string;
};

/** One DLP scan, as shown in the Redaction panel. */
export type DlpReport = {
  id: string;
  at: number;
  verdict: Verdict;
  /** Sensitivity, 0..1, from Clef's score. */
  sensitivity: number;
  counts: Record<string, number>;
  segments: ReportSegment[];
  redacted: string;
};

export type AgentState = {
  model: ModelKey;
  traces: DecisionTrace[];
  reports: DlpReport[];
};

export const INITIAL_STATE: AgentState = {
  model: DEFAULT_MODEL,
  traces: [],
  reports: [],
};
export const MAX_REPORTS = 5;
export const MAX_TRACES = 40;
