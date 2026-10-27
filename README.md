# DLP Redactor

**Cloudflare Peer Point User Group: System One hackathon starter**

**Vault** is a helpful work assistant that never sees your secrets. Every message passes through a
data loss prevention layer first: **Clef-flash** decides which kinds of sensitive data are present,
**Clairic** pins their exact character spans, and deterministic detectors back both up. The LLM only
ever receives placeholders like `[CARD_1]` or `[NAME_2]`, and it can still do the job: draft the
dispute email, summarise the patient note, debug the config.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/vnikhilbuddhavarapu/ppug-dlp-redactor)

```
 "my card 4111…"   ┌──────────── Durable Object (one per chat session) ─────────────┐
 browser ───ws────▶│ Think agent ── beforeTurn                                        │
                   │   1. clef-flash : which classes? (7 yes/no + sensitivity score)   │
                   │   2. clairic    : exact spans, only for flagged classes           │
                   │   3. detectors  : regex + Luhn checksum (defence in depth)        │
                   │   4. redact     : "my card [CARD_1] …" ──▶ LLM                    │
                   │   earlier messages stay redacted on every later turn              │
                   └──────────────────────────┬──────────────────────────────────────┘
                                              ▼  every model call
                                  AI Gateway (logs, metadata, analytics)
```

## What you get out of the box

- **A working, stateful chat agent** on the [Think harness](https://developers.cloudflare.com/agents/harnesses/think/):
  streaming, persistent memory and history in a Durable Object.
- **The DLP layer (CHECKPOINT 0), already working**: 7 data classes (government IDs, cards, bank
  accounts, credentials, health, contact details, names), with stable typed placeholders.
- **"Decide, then extract"**: Clef runs on every message in about 50 ms; Clairic only runs when Clef
  finds something. That's the cost-efficient System One pattern.
- **Redaction panel**: the original message with highlighted spans next to exactly what the LLM
  received, plus a sensitivity gauge and a copy button.
- **Decision Trace panel**: every Clef/Clairic call with probabilities, latency and cost.
- **Two LLMs on Workers AI** behind a switcher, routed through **AI Gateway**.

## Quickstart (10 minutes)

Prerequisites: Node.js 24+, and a Cloudflare account (provided at the event).

```bash
git clone https://github.com/vnikhilbuddhavarapu/ppug-dlp-redactor
cd ppug-dlp-redactor
npm install
npx wrangler login        # Workers AI has no local simulator, so dev talks to your account
npm run dev               # http://localhost:5173
```

If your login can see several accounts, run `CLOUDFLARE_ACCOUNT_ID=<id> npm run dev`.

Ship it (Wrangler creates the R2 bucket used in checkpoint 2 on first deploy):

```bash
npm run deploy
```

### Try the scenarios

| Scenario          | What the LLM receives                                                        |
| ----------------- | ---------------------------------------------------------------------------- |
| Payroll email     | `[NAME_1], SSN [GOV_ID_1], new address [CONTACT_1] … routing [BANK_1]`       |
| Leaked API key    | `AWS_ACCESS_KEY_ID=[SECRET_1] … AWS_REGION=us-east-1` (region kept)          |
| Patient note      | `[NAME_1] … diagnosed with [HEALTH_1] and prescribed [HEALTH_2]`             |
| Card dispute      | `My card [CARD_1] exp 09/29 …`                                               |
| Nothing sensitive | unchanged; Clef says clean and Clairic is never called                       |

Then ask *"What SSN did I give you?"*. Vault can't tell you, because it never saw it.

## Checkpoints

The event runs for 90 minutes. Checkpoint 0 already works; the rest are yours.

### CHECKPOINT 0: explore the DLP layer (10 min)

- [`src/dlp/classes.ts`](src/dlp/classes.ts): `DATA_CLASSES` is the whole policy surface. Each class is one Clef
  question, one Clairic field and a placeholder label. **Add a class** (the patient note leaks a date
  of birth: try `date_of_birth`), or a domain-specific one such as `employee_id` or `customer_account`.
- [`src/dlp/redact.ts`](src/dlp/redact.ts): detectors, span handling, merging and placeholders. All pure functions, all tested.
- [`src/server.ts`](src/server.ts) → `beforeTurn()` and `scanText()` wire it into the agent.

### CHECKPOINT 1: a per-class policy (25 min)

Today everything found is masked. Real DLP needs choices per class:

- `mask`: `[CARD_1]` (today's behaviour)
- `partial`: keep a hint, e.g. `[CARD_1 ••1111]`, so the LLM can tell cards apart
- `allow`: leave it (names might be fine internally)
- `block`: withhold the whole message (a pasted private key should never be "helped with")

1. Add a `policy: Record<DataClass, "mask" | "partial" | "allow" | "block">` to `AgentState`
   (`src/shared.ts`) and a `@callable() setPolicy()` method.
2. Apply it in `scanText()` at the `CHECKPOINT 1` comment, before `redact()`.
3. Bonus: add per-class dropdowns to the Redaction panel (`src/ui/extensions.tsx`).

### CHECKPOINT 2: images and screenshots (25 min)

People paste screenshots of cards, IDs and dashboards. Clef and Clairic both read images.

1. In `beforeTurn()`, find image parts in the latest user message (`ctx.messages`).
2. Store each one in R2 (`this.env.UPLOADS.put(...)`, binding already configured) for the audit trail.
3. Run Clef with `images: [dataUrl]` (`model: "clef"`) on `DETECT_QUESTIONS`, and Clairic with
   `images` to pull the values.
4. Never forward a sensitive image to the LLM: replace it with a text note such as
   `[image withheld by DLP: CARD, NAME]`.

### Stretch goals (if you're fast)

- **Output DLP**: scan the LLM's reply in `onChatResponse()`. Did it reconstruct something it shouldn't have?
- **Re-hydration for the owner**: show the user the reply with placeholders swapped back to the real
  values, client-side only, so the originals never touch the LLM.
- **Audit log**: write every redaction (class, count, sensitivity) to Durable Object SQLite, and add a
  "DLP report" tool the LLM can query without seeing values.
- **Redact the stored transcript**: Think persists the original user message; rewrite it with the
  redacted text so it is not stored at rest.
- **Escalation**: low-confidence spans (`confidence < 0.6`) go to human review instead of auto-redaction.

A reference implementation of checkpoints 1 and 2 lives on the `solutions` branch.

## How it works

| Piece                                | Where                                                 |
| ------------------------------------ | ----------------------------------------------------- |
| Agent (`beforeTurn`, `scanText`)     | `src/server.ts`                                       |
| Data classes, Clef questions, fields | `src/dlp/classes.ts`                                  |
| Detectors, spans, placeholders       | `src/dlp/redact.ts`                                   |
| Transcript helpers                   | `src/dlp/transcript.ts`                               |
| Base agent: model, memory, traces    | `src/agent/system-one-agent.ts`                       |
| Typed Clef / Clairic clients         | `src/system-one/*.ts`                                 |
| Shared types (server + UI)           | `src/shared.ts`                                       |
| UI (Redaction panel)                 | `src/ui/extensions.tsx`                               |

> **Demo caveat.** For the Redaction panel, the latest reports (including the original text) live in
> agent state and sync to your browser, and Think stores the original message in the transcript.
> Before production use, keep originals out of state and redact the stored transcript (see stretch goals).

### System One models

| Model        | Used here for                                 | Price (input only) |
| ------------ | --------------------------------------------- | ------------------ |
| `clef-flash` | which data classes are present (every message) | $0.038 / M tokens  |
| `clairic`    | exact spans for flagged classes               | $0.10 / M tokens   |
| `clef`       | images (checkpoint 2)                         | $0.24 / M tokens   |

Docs: [Clef](https://developers.cloudflare.com/workers-ai/models/clef/) ·
[Clairic](https://developers.cloudflare.com/workers-ai/models/clairic/) ·
[Extraction models](https://developers.cloudflare.com/workers-ai/concepts/extraction-models/) ·
[Think](https://developers.cloudflare.com/agents/harnesses/think/) ·
[AI Gateway](https://developers.cloudflare.com/ai-gateway/) ·
[Cloudflare DLP](https://developers.cloudflare.com/cloudflare-one/data-loss-prevention/)

## Scripts

| Command          | What it does                                         |
| ---------------- | ---------------------------------------------------- |
| `npm run dev`    | local dev (AI calls go to your account)              |
| `npm run deploy` | build and deploy to Workers                          |
| `npm test`       | unit tests (no Cloudflare account needed)            |
| `npm run check`  | format check, lint, typecheck                        |
| `npm run types`  | regenerate `env.d.ts` after editing `wrangler.jsonc` |

## Troubleshooting

- **`Not logged in` / AI errors**: run `npx wrangler login`. Set `CLOUDFLARE_ACCOUNT_ID` if you have
  several accounts.
- **A value was missed**: check the Decision Trace. Was the class flagged (Clef) but the span missed
  (Clairic), or not flagged at all? Reword the question or field, or add a detector.
- **`requires compatibility date …`**: keep the pinned versions (`npm ci`).
- **Logs**: Dashboard → AI → AI Gateway → `default`, and Workers & Pages → your Worker → Observability.
