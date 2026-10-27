/**
 * Use-case branding and one-click demo scenarios, shared by the agent and the UI.
 */
export type Scenario = {
  label: string;
  prompt: string;
  /** Optional sample file in /public attached to the message. */
  attachment?: string;
};

export const APP = {
  slug: "ppug-dlp-redactor",
  name: "DLP Redactor",
  tagline:
    "Clef spots sensitive data, Clairic pins the exact spans, and the LLM only sees placeholders.",
  scenarios: [
    {
      label: "Payroll email",
      prompt:
        "Draft a reply confirming we updated payroll: Hi, please update payroll for Jane Doe, SSN 123-45-6789, new address 742 Evergreen Terrace, Springfield IL 62704. Direct deposit: routing 021000021, account 4400123987.",
    },
    {
      label: "Leaked API key",
      prompt:
        "Prod is failing with 401s, what's wrong with our config?\n\nAWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE\nAWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY\nSTRIPE_KEY=sk_live_51HxExampleKey00000000\nAWS_REGION=us-east-1",
    },
    {
      label: "Patient note",
      prompt:
        "Summarize this for the care team: Patient Mark Chen (DOB 1979-04-12) was diagnosed with type 2 diabetes and prescribed metformin 500mg twice daily. Reach him at mark.chen@example.com or 555-0134.",
    },
    {
      label: "Card dispute",
      prompt:
        "My card 4111 1111 1111 1111 exp 09/29 was charged twice by Acme Cloud on Oct 3. Help me write a dispute email to my bank.",
    },
    {
      label: "Nothing sensitive",
      prompt: "Write a haiku about Durable Objects.",
    },
  ] satisfies Scenario[],
};
