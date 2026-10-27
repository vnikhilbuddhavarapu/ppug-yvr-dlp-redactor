import type { ListAnswer } from "../system-one/clairic";
import { DATA_CLASSES, type DataClass } from "./classes";

export type Finding = {
  cls: DataClass;
  start: number;
  end: number;
  value: string;
  source: "clairic" | "detector";
  confidence?: number;
};

/**
 * Deterministic detectors. Cheap, exact and explainable; the models catch what these cannot
 * (names, diagnoses, oddly formatted IDs), and these catch what a model might miss.
 */
const DETECTORS: Array<{
  cls: DataClass;
  pattern: RegExp;
  valid?: (match: string) => boolean;
}> = [
  { cls: "payment_card", pattern: /\b(?:\d[ -]?){13,19}\b/g, valid: luhn },
  { cls: "government_id", pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
  { cls: "credential", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  {
    cls: "credential",
    pattern: /\b(?:sk|pk|rk)_(?:live|test)_[0-9a-zA-Z]{8,}\b/g,
  },
  { cls: "credential", pattern: /\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}\b/g },
  { cls: "contact", pattern: /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g },
];

export function luhn(candidate: string): boolean {
  const digits = candidate.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export function runDetectors(text: string): Finding[] {
  const findings: Finding[] = [];
  for (const { cls, pattern, valid } of DETECTORS) {
    for (const m of text.matchAll(pattern)) {
      const value = m[0].trim();
      if (valid && !valid(value)) continue;
      const start = (m.index ?? 0) + m[0].indexOf(value);
      findings.push({
        cls,
        start,
        end: start + value.length,
        value,
        source: "detector",
      });
    }
  }
  return findings;
}

/**
 * Turn Clairic list answers into findings. Clairic returns spans (character offsets into the
 * input); when a span is missing we fall back to locating the value in the text.
 */
export function clairicFindings(
  text: string,
  answers: Partial<Record<DataClass, ListAnswer>>,
): Finding[] {
  const findings: Finding[] = [];
  for (const [cls, answer] of Object.entries(answers) as Array<
    [DataClass, ListAnswer | undefined]
  >) {
    if (!answer) continue;
    answer.value.forEach((raw, i) => {
      const value = String(raw).trim();
      // Validate in code: a numeric identifier with no digits is a label ("SSN"), not a value.
      if (value.length < 3 || (NUMERIC_CLASSES.has(cls) && !/\d/.test(value)))
        return;
      const span = answer.spans?.[i];
      const start =
        span && text.slice(span[0], span[1]).trim() === value
          ? span[0] + text.slice(span[0], span[1]).indexOf(value)
          : text.indexOf(value);
      if (start < 0) return;
      findings.push({
        cls,
        start,
        end: start + value.length,
        value,
        source: "clairic",
        confidence: answer.confidence,
      });
    });
  }
  return findings;
}

const NUMERIC_CLASSES = new Set<DataClass>([
  "government_id",
  "payment_card",
  "bank_account",
]);

/**
 * Sort and merge findings: overlapping spans collapse into one, and same-class spans separated only
 * by a comma or space ("742 Evergreen Terrace, Springfield IL 62704") become a single value.
 */
export function mergeFindings(text: string, findings: Finding[]): Finding[] {
  const sorted = [...findings].sort(
    (a, b) => a.start - b.start || b.end - a.end,
  );
  const merged: Finding[] = [];
  for (const f of sorted) {
    const last = merged.at(-1);
    const adjacent =
      last?.cls === f.cls && /^[\s,]{1,3}$/.test(text.slice(last.end, f.start));
    if (last && (f.start < last.end || adjacent)) {
      if (f.end > last.end) {
        merged[merged.length - 1] = {
          ...last,
          end: f.end,
          value: text.slice(last.start, f.end),
        };
      }
      continue;
    }
    merged.push(f);
  }
  return merged;
}

export type Segment = { text: string; cls?: DataClass; placeholder?: string };

export type Redaction = {
  redacted: string;
  segments: Segment[];
  counts: Partial<Record<DataClass, number>>;
};

/**
 * Replace each finding with a typed, numbered placeholder ([CARD_1], [NAME_2]...). The same value
 * always gets the same placeholder, so the LLM can still reason about "who" and "which card".
 */
export function redact(text: string, findings: Finding[]): Redaction {
  const segments: Segment[] = [];
  const counts: Partial<Record<DataClass, number>> = {};
  const assigned = new Map<string, string>();
  let cursor = 0;
  for (const f of mergeFindings(text, findings)) {
    if (f.start > cursor) segments.push({ text: text.slice(cursor, f.start) });
    const key = `${f.cls}:${f.value.toLowerCase()}`;
    let placeholder = assigned.get(key);
    if (!placeholder) {
      counts[f.cls] = (counts[f.cls] ?? 0) + 1;
      placeholder = `[${DATA_CLASSES[f.cls].label}_${counts[f.cls]}]`;
      assigned.set(key, placeholder);
    }
    segments.push({
      text: text.slice(f.start, f.end),
      cls: f.cls,
      placeholder,
    });
    cursor = f.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) });
  return {
    redacted: segments.map((s) => s.placeholder ?? s.text).join(""),
    segments,
    counts,
  };
}
