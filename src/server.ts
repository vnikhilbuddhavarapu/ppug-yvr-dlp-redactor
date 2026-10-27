import type { TurnConfig, TurnContext } from "@cloudflare/think";
import { routeAgentRequest } from "agents";
import type { ModelMessage } from "ai";
import { SystemOneAgent } from "./agent/system-one-agent";
import { APP } from "./app";
import {
  DETECT_QUESTIONS,
  extractionFields,
  flaggedClasses,
  type DataClass,
} from "./dlp/classes";
import {
  clairicFindings,
  redact,
  runDetectors,
  type Redaction,
} from "./dlp/redact";
import { applyRedactions, fingerprint, lastUserText } from "./dlp/transcript";
import { MAX_REPORTS, type DlpReport } from "./shared";
import { normalizedScore } from "./system-one/clef";
import type { ListAnswer } from "./system-one/clairic";

const REDACTIONS_KEY = "dlp:redactions";
const MAX_REDACTIONS = 200;
/** Clef probability at which a data class counts as present. */
const DETECT_THRESHOLD = 0.5;

export class ChatAgent extends SystemOneAgent {
  readonly appSlug = APP.slug;

  soul() {
    return [
      "You are Vault, a helpful work assistant that sits behind a data loss prevention (DLP) layer.",
      "Sensitive values in user messages are replaced with placeholders like [CARD_1], [NAME_2] or",
      "[SECRET_1] before you see them. Use the placeholders as-is when you refer to those values,",
      "never guess or invent the originals, and never ask the user to re-send them.",
      "Help with the task (drafting, summarizing, debugging) and keep answers concise.",
    ].join(" ");
  }

  // ---------------------------------------------------------------------------------------------
  // CHECKPOINT 0 (ships working): every user message is scanned and redacted before the LLM.
  // ---------------------------------------------------------------------------------------------
  override async beforeTurn(ctx: TurnContext): Promise<TurnConfig | void> {
    const redactions = this.redactions();
    const text = lastUserText(ctx.messages);
    if (ctx.continuation || !text)
      return { messages: await applyRedactions(ctx.messages, redactions) };

    let redaction: Redaction;
    try {
      redaction = await this.scanText(text);
    } catch (error) {
      // Fail closed: if DLP cannot scan, the LLM gets nothing it could leak.
      console.error("DLP scan failed", error);
      const messages = await applyRedactions(ctx.messages, redactions);
      return {
        messages: replaceLastUser(
          messages,
          "[message withheld: the DLP scan is unavailable, ask the user to retry]",
        ),
        activeTools: [],
      };
    }
    if (redaction.redacted !== text) {
      redactions[await fingerprint(text)] = redaction.redacted;
      this.saveRedactions(redactions);
    }
    return {
      messages: annotate(
        await applyRedactions(ctx.messages, redactions),
        redaction,
      ),
    };
  }

  /** Decide (Clef) → extract spans (Clairic) + deterministic detectors → redact. */
  async scanText(text: string): Promise<Redaction> {
    const { answers } = await this.decideTraced(
      { model: "clef-flash", state: text, questions: DETECT_QUESTIONS },
      {
        step: "DLP detect",
        verdict: (a) =>
          flaggedClasses(a, DETECT_THRESHOLD).length ? "review" : "allow",
        summary: (a) =>
          flaggedClasses(a, DETECT_THRESHOLD).join(", ") || "no sensitive data",
      },
    );
    const flagged = flaggedClasses(answers, DETECT_THRESHOLD);
    const findings = runDetectors(text);

    // Only pay for extraction when Clef says there is something to extract.
    if (flagged.length) {
      const { answers: spans } = await this.extractTraced(
        { state: text, fields: extractionFields(flagged) },
        { step: "DLP extract spans" },
      );
      findings.push(
        ...clairicFindings(
          text,
          spans as Partial<Record<DataClass, ListAnswer>>,
        ),
      );
    }

    // CHECKPOINT 1: apply a per-class policy here (mask / partial / allow / block). See README.
    const redaction = redact(text, findings);
    this.saveReport(redaction, normalizedScore(answers.sensitivity));
    return redaction;
  }

  private saveReport(redaction: Redaction, sensitivity: number) {
    const found = Object.keys(redaction.counts).length > 0;
    const report: DlpReport = {
      id: crypto.randomUUID(),
      at: Date.now(),
      verdict: found ? (sensitivity >= 0.66 ? "block" : "review") : "allow",
      sensitivity,
      counts: redaction.counts as Record<string, number>,
      segments: redaction.segments,
      redacted: redaction.redacted,
    };
    this.setState({
      ...this.state,
      reports: [report, ...this.state.reports].slice(0, MAX_REPORTS),
    });
  }

  private redactions(): Record<string, string> {
    return (
      this.ctx.storage.kv.get<Record<string, string>>(REDACTIONS_KEY) ?? {}
    );
  }

  private saveRedactions(map: Record<string, string>) {
    this.ctx.storage.kv.put(
      REDACTIONS_KEY,
      Object.fromEntries(Object.entries(map).slice(-MAX_REDACTIONS)),
    );
  }
}

/** Tell the model what happened, next to the message, so it uses placeholders naturally. */
function annotate(
  messages: ModelMessage[],
  redaction: Redaction,
): ModelMessage[] {
  const summary = Object.entries(redaction.counts)
    .map(([cls, n]) => `${n} ${cls}`)
    .join(", ");
  if (!summary) return messages;
  return replaceLastUser(
    messages,
    `${redaction.redacted}\n\n[DLP note to assistant: redacted ${summary}. Use the placeholders as-is.]`,
  );
}

function replaceLastUser(
  messages: ModelMessage[],
  content: string,
): ModelMessage[] {
  let i = messages.length - 1;
  while (i >= 0 && messages[i]?.role !== "user") i--;
  if (i < 0) return messages;
  const copy = [...messages];
  copy[i] = { role: "user", content };
  return copy;
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      return Response.json({
        ok: true,
        app: APP.slug,
        gateway: env.AI_GATEWAY_ID,
      });
    }
    return (
      (await routeAgentRequest(request, env)) ??
      new Response("Not found", { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;
