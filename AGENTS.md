# AGENTS.md: DLP Redactor (PPUG System One starter)

Context for AI coding agents (OpenCode, Devin, Claude Code, Cursor) working in this repo.

## What this is

A hackathon starter: a stateful Cloudflare **Think** chat agent ("Vault") behind a data loss
prevention layer. **Clef-flash** decides which sensitive data classes a message contains, **Clairic**
extracts their exact spans, and regex/checksum detectors back both up. The LLM only sees typed
placeholders. Attendees extend it through checkpoints (see README.md). Keep changes small, demoable
and consistent with the existing structure.

## Commands

| Command          | Purpose                                                    |
| ---------------- | ---------------------------------------------------------- |
| `npm run dev`    | Vite + Workers dev server; AI binding is remote (needs `wrangler login`) |
| `npm test`       | Vitest unit tests in Node with a mocked AI binding         |
| `npm run check`  | `oxfmt --check`, `oxlint`, `tsc --noEmit`. Run before declaring done |
| `npm run format` | auto-format                                                |
| `npm run types`  | regenerate `env.d.ts` after changing `wrangler.jsonc`      |
| `npm run deploy` | build and deploy. **Ask the user before deploying.**       |

## Architecture

- `src/server.ts`: `ChatAgent extends SystemOneAgent`. **Use-case logic goes here.**
  - `beforeTurn(ctx)`: CHECKPOINT 0. Scans the latest user message, stores a fingerprint → redacted
    text map in `ctx.storage.kv`, and swaps every previously redacted message on each turn. It fails
    closed: if scanning throws, the message is withheld.
  - `scanText(text)`: `decideTraced` (clef-flash, `DETECT_QUESTIONS`) → `runDetectors` → `extractTraced`
    (Clairic, only flagged classes) → `redact` → `saveReport` (state for the UI).
  - CHECKPOINT 1 (attendee): per-class policy applied before `redact()`.
  - CHECKPOINT 2 (attendee): image DLP with R2 (`env.UPLOADS`) plus Clef/Clairic `images`.
- `src/dlp/classes.ts`: `DATA_CLASSES` (one entry = Clef question + Clairic field + placeholder label),
  `DETECT_QUESTIONS`, `extractionFields()`, `flaggedClasses()`.
- `src/dlp/redact.ts`: detectors (regex + Luhn), `clairicFindings()` (spans with fallback and value
  validation), `mergeFindings()`, `redact()` (stable numbered placeholders). Pure and unit-tested.
- `src/dlp/transcript.ts`: `lastUserText`, `fingerprint`, `applyRedactions`.
- `src/agent/system-one-agent.ts`: shared base, rarely needs edits.
- `src/shared.ts`: `AgentState` (`reports`), `DlpReport`, `DecisionTrace`, `MODELS`.
- `src/ui/extensions.tsx`: Redaction panel.

## Rules for changes

- **The LLM must never receive original sensitive values.** Anything new that feeds the model (tools,
  images, memory) goes through the DLP layer first.
- Call System One models through `this.decideTraced()` / `this.extractTraced()`.
- Clef: 1-64 questions, `noul` / `choice` / `score`; images as base64 data URLs (max 4), `clef` or
  `clef-flash` for images, `clef-omni` for audio/video.
- Clairic: list fields return `value[]` and `spans[]` (character offsets into `state`). Validate
  values in code before trusting them (see `clairicFindings`).
- New state fields go in `AgentState` and `INITIAL_STATE`. Update with `this.setState({ ...this.state, x })`.
- Add or update tests in `test/` alongside behaviour changes. Never weaken tests to pass.

## Docs (fetch these; APIs move fast)

- Think: https://developers.cloudflare.com/agents/harnesses/think/ (lifecycle hooks: `beforeTurn`)
- Clef: https://developers.cloudflare.com/workers-ai/models/clef/
- Clairic: https://developers.cloudflare.com/workers-ai/models/clairic/
- Extraction models: https://developers.cloudflare.com/workers-ai/concepts/extraction-models/
- R2 Workers API: https://developers.cloudflare.com/r2/api/workers/workers-api-reference/
- AI Gateway: https://developers.cloudflare.com/ai-gateway/
- Cloudflare docs index for LLMs: https://developers.cloudflare.com/llms.txt
