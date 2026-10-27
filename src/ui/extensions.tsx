import { Copy, Eye, EyeSlash, LockKey } from "@phosphor-icons/react";
import { useState } from "react";
import type { AgentState, DlpReport } from "../shared";
import { cx, ProbBar, VerdictBadge } from "./primitives";

export type ExtensionProps = {
  state: AgentState;
  /** Call a `@callable()` method on your agent, e.g. `call("setPolicy", [policy])`. */
  call: (method: string, args: unknown[]) => Promise<unknown>;
};

const CLASS_STYLES: Record<string, string> = {
  government_id: "bg-block/20 text-block ring-block/40",
  payment_card: "bg-block/20 text-block ring-block/40",
  bank_account: "bg-block/20 text-block ring-block/40",
  credential: "bg-brand/20 text-brand ring-brand/40",
  health: "bg-info/20 text-info ring-info/40",
  contact: "bg-review/20 text-review ring-review/40",
  person_name: "bg-allow/15 text-allow ring-allow/40",
};
const styleFor = (cls?: string) =>
  (cls && CLASS_STYLES[cls]) || "bg-raised text-muted ring-line";

function ReportView({ report }: { report: DlpReport }) {
  const [reveal, setReveal] = useState(true);
  const [copied, setCopied] = useState(false);
  const counts = Object.entries(report.counts);

  const copy = () =>
    void navigator.clipboard.writeText(report.redacted).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <VerdictBadge verdict={report.verdict} />
        <span className="text-xs text-muted">
          {counts.length
            ? `${counts.reduce((n, [, c]) => n + c, 0)} values redacted`
            : "nothing sensitive"}
        </span>
        <div className="ml-auto flex gap-1">
          <button
            type="button"
            onClick={() => setReveal(!reveal)}
            className="rounded-md p-1 text-faint hover:bg-raised hover:text-ink"
            title={
              reveal
                ? "Show what the LLM sees"
                : "Show original with highlights"
            }
          >
            {reveal ? <EyeSlash size={14} /> : <Eye size={14} />}
          </button>
          <button
            type="button"
            onClick={copy}
            className="rounded-md p-1 text-faint hover:bg-raised hover:text-ink"
            title="Copy redacted text"
          >
            <Copy size={14} className={copied ? "text-allow" : undefined} />
          </button>
        </div>
      </div>
      {counts.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {counts.map(([cls, n]) => (
            <span
              key={cls}
              className={cx(
                "rounded px-1.5 py-0.5 font-mono text-[10px] ring-1",
                styleFor(cls),
              )}
            >
              {cls} ×{n}
            </span>
          ))}
        </div>
      )}
      <div>
        <div className="mb-1 flex justify-between text-[10px] text-faint">
          <span>sensitivity</span>
          <span className="font-mono">
            {Math.round(report.sensitivity * 100)}%
          </span>
        </div>
        <ProbBar value={report.sensitivity} danger />
      </div>
      <p className="scrollbar-thin max-h-56 overflow-y-auto rounded-lg bg-raised/50 p-2 text-[13px] leading-relaxed whitespace-pre-wrap">
        {report.segments.map((s, i) =>
          s.cls ? (
            <mark
              key={i}
              title={s.cls}
              className={cx(
                "rounded px-0.5 font-mono text-[12px] ring-1",
                styleFor(s.cls),
              )}
            >
              {reveal ? s.text : s.placeholder}
            </mark>
          ) : (
            <span key={i}>{s.text}</span>
          ),
        )}
      </p>
      <p className="text-[10px] text-faint">
        {reveal
          ? "Highlighted: what DLP found. The LLM never sees these values."
          : "Exactly what the LLM received."}
      </p>
    </div>
  );
}

/** The latest DLP scan: highlighted original vs. what the LLM actually received. */
export function SidebarExtras({ state }: ExtensionProps) {
  const latest = state.reports[0];
  if (!latest) return null;
  return (
    <section className="space-y-2 border-b border-line px-4 py-3">
      <div className="flex items-center gap-2">
        <LockKey weight="duotone" className="text-brand" />
        <h2 className="text-sm font-semibold tracking-tight">Redaction</h2>
        <span className="ml-auto font-mono text-[10px] text-faint">
          {new Date(latest.at).toLocaleTimeString()}
        </span>
      </div>
      <ReportView key={latest.id} report={latest} />
    </section>
  );
}
