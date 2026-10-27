import type { ModelMessage } from "ai";

/** Text of the most recent user message in a model transcript. */
export function lastUserText(messages: readonly ModelMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === "user") return messageText(m);
  }
  return "";
}

export function messageText(message: ModelMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n")
    .trim();
}

export async function fingerprint(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text.trim()),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Swap every user message we have redacted before for its redacted text, so originals never reach
 * the LLM: not on this turn, and not later as conversation history.
 */
export async function applyRedactions(
  messages: ModelMessage[],
  redactions: Readonly<Record<string, string>>,
): Promise<ModelMessage[]> {
  if (Object.keys(redactions).length === 0) return messages;
  return Promise.all(
    messages.map(async (m): Promise<ModelMessage> => {
      if (m.role !== "user") return m;
      const redacted = redactions[await fingerprint(messageText(m))];
      return redacted === undefined ? m : { role: "user", content: redacted };
    }),
  );
}
