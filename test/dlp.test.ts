import type { ModelMessage } from "ai";
import { describe, expect, it } from "vitest";
import {
  extractionFields,
  flaggedClasses,
  type DetectAnswers,
} from "../src/dlp/classes";
import {
  clairicFindings,
  luhn,
  mergeFindings,
  redact,
  runDetectors,
  type Finding,
} from "../src/dlp/redact";
import {
  applyRedactions,
  fingerprint,
  lastUserText,
} from "../src/dlp/transcript";

const PAYROLL =
  "Update payroll for Jane Doe, SSN 123-45-6789, new address 742 Evergreen Terrace, Springfield IL 62704.";

describe("detectors", () => {
  it("validates card numbers with the Luhn checksum", () => {
    expect(luhn("4111 1111 1111 1111")).toBe(true);
    expect(luhn("4111 1111 1111 1112")).toBe(false);
    expect(luhn("1234")).toBe(false);
  });

  it("finds cards, SSNs, cloud keys and emails, and skips non-Luhn digit runs", () => {
    const text =
      "card 4111 1111 1111 1111, order 1234 5678 9012 3456, ssn 123-45-6789, AKIAIOSFODNN7EXAMPLE, a@b.example";
    const found = runDetectors(text).map((f) => [f.cls, f.value]);
    expect(found).toEqual([
      ["payment_card", "4111 1111 1111 1111"],
      ["government_id", "123-45-6789"],
      ["credential", "AKIAIOSFODNN7EXAMPLE"],
      ["contact", "a@b.example"],
    ]);
  });
});

describe("clairicFindings", () => {
  it("uses spans, falls back to search, and drops labels that are not values", () => {
    const findings = clairicFindings(PAYROLL, {
      person_name: { type: "list", value: ["Jane Doe"], spans: [[19, 27]] },
      government_id: { type: "list", value: ["SSN", "123-45-6789"] },
    });
    expect(
      findings.map((f) => [f.cls, f.value, PAYROLL.slice(f.start, f.end)]),
    ).toEqual([
      ["person_name", "Jane Doe", "Jane Doe"],
      ["government_id", "123-45-6789", "123-45-6789"],
    ]);
  });
});

const f = (cls: Finding["cls"], value: string): Finding => {
  const start = PAYROLL.indexOf(value);
  return { cls, start, end: start + value.length, value, source: "clairic" };
};

describe("mergeFindings", () => {
  it("joins same-class pieces separated by a comma or space", () => {
    const merged = mergeFindings(PAYROLL, [
      f("contact", "742 Evergreen Terrace"),
      f("contact", "Springfield IL"),
      f("contact", "62704"),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.value).toBe(
      "742 Evergreen Terrace, Springfield IL 62704",
    );
  });

  it("collapses overlapping detector and model findings", () => {
    const merged = mergeFindings(PAYROLL, [
      f("government_id", "123-45-6789"),
      { ...f("government_id", "123-45-6789"), source: "detector" },
    ]);
    expect(merged).toHaveLength(1);
  });
});

describe("redact", () => {
  it("replaces values with stable, typed placeholders", () => {
    const text = "Jane Doe emailed. Later Jane Doe called from 555-0134.";
    const at = (v: string, from = 0) => text.indexOf(v, from);
    const findings: Finding[] = [
      {
        cls: "person_name",
        start: at("Jane Doe"),
        end: at("Jane Doe") + 8,
        value: "Jane Doe",
        source: "clairic",
      },
      {
        cls: "person_name",
        start: at("Jane Doe", 10),
        end: at("Jane Doe", 10) + 8,
        value: "Jane Doe",
        source: "clairic",
      },
      {
        cls: "contact",
        start: at("555-0134"),
        end: at("555-0134") + 8,
        value: "555-0134",
        source: "clairic",
      },
    ];
    const r = redact(text, findings);
    expect(r.redacted).toBe(
      "[NAME_1] emailed. Later [NAME_1] called from [CONTACT_1].",
    );
    expect(r.counts).toEqual({ person_name: 1, contact: 1 });
    expect(r.segments.filter((s) => s.cls).map((s) => s.text)).toEqual([
      "Jane Doe",
      "Jane Doe",
      "555-0134",
    ]);
  });

  it("returns the text unchanged when nothing was found", () => {
    expect(redact("hello", []).redacted).toBe("hello");
  });
});

describe("classes", () => {
  it("flags classes above the threshold, strongest first, and builds matching Clairic fields", () => {
    const answers = {
      government_id: { type: "noul", noul: 0.6 },
      payment_card: { type: "noul", noul: 0.95 },
      bank_account: { type: "noul", noul: 0.1 },
      credential: { type: "noul", noul: 0.01 },
      health: { type: "noul", noul: 0.01 },
      contact: { type: "noul", noul: 0.4 },
      person_name: { type: "noul", noul: 0.02 },
      sensitivity: {
        type: "score",
        score: 2,
        legend: {},
        probabilities: {},
        confidence: 1,
      },
    } as DetectAnswers;
    const flagged = flaggedClasses(answers, 0.5);
    expect(flagged).toEqual(["payment_card", "government_id"]);
    expect(Object.keys(extractionFields(flagged))).toEqual([
      "payment_card",
      "government_id",
    ]);
  });
});

describe("transcript", () => {
  it("redacts earlier user messages on every turn", async () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "SSN 123-45-6789" },
      { role: "assistant", content: "ok" },
      { role: "user", content: "what was it?" },
    ];
    const out = await applyRedactions(messages, {
      [await fingerprint("SSN 123-45-6789")]: "SSN [GOV_ID_1]",
    });
    expect(out[0]).toEqual({ role: "user", content: "SSN [GOV_ID_1]" });
    expect(out[2]).toEqual(messages[2]);
    expect(lastUserText(out)).toBe("what was it?");
  });
});
