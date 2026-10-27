import type { ClairicFields, ListField } from "../system-one/clairic";
import type { ClefAnswers } from "../system-one/clef";

/**
 * CHECKPOINT 0 (ships working): the data classes this DLP layer protects.
 *
 * The pattern is "decide, then extract":
 *   1. clef-flash answers one yes/no question per class for the whole message (~50ms, one pass).
 *   2. Clairic extracts exact character spans, only for the classes Clef flagged.
 *   3. Deterministic detectors (regex + checksums) back both up, because DLP needs defence in depth.
 *
 * Add a class by adding one entry here: a Clef question, a Clairic field and a placeholder label.
 */
export const DATA_CLASSES = {
  government_id: {
    label: "GOV_ID",
    question:
      "Does the text contain a government ID number such as an SSN, SIN, passport or driver's licence number?",
    field:
      "Government ID numbers (SSN, SIN, passport, driver's licence), exactly as written",
  },
  payment_card: {
    label: "CARD",
    question: "Does the text contain a full payment card number?",
    field: "Full payment card numbers, exactly as written",
  },
  bank_account: {
    label: "BANK",
    question:
      "Does the text contain bank account, routing, transit or IBAN numbers?",
    field: "Bank account, routing, transit and IBAN numbers",
  },
  credential: {
    label: "SECRET",
    question:
      "Does the text contain a password, API key, access token or private key?",
    field:
      "Passwords, API keys, access tokens and private keys (the secret value only)",
  },
  health: {
    label: "HEALTH",
    question:
      "Does the text mention a person's medical condition, diagnosis, treatment or medication?",
    field: "Medical conditions, diagnoses, treatments and medications",
  },
  contact: {
    label: "CONTACT",
    question:
      "Does the text contain a private person's email address, phone number or home address?",
    field: "Personal email addresses, phone numbers and street addresses",
  },
  person_name: {
    label: "NAME",
    question:
      "Does the text name a private individual (not a company or public figure)?",
    field: "Full names of private individuals",
  },
} as const;

export type DataClass = keyof typeof DATA_CLASSES;
export const CLASS_KEYS = Object.keys(DATA_CLASSES) as DataClass[];

export const DETECT_QUESTIONS = {
  ...(Object.fromEntries(
    CLASS_KEYS.map((k) => [
      k,
      { type: "noul", instructions: DATA_CLASSES[k].question },
    ]),
  ) as Record<DataClass, { type: "noul"; instructions: string }>),
  sensitivity: {
    type: "score",
    instructions:
      "How sensitive is this text if it leaked outside the company?",
    criteria: ["Public", "Internal", "Confidential", "Restricted"],
  },
} as const;

export type DetectAnswers = ClefAnswers<typeof DETECT_QUESTIONS>;

/** Clairic list fields (one per flagged class) that return exact spans of the input. */
export function extractionFields(classes: readonly DataClass[]): ClairicFields {
  return Object.fromEntries(
    classes.map((k): [string, ListField] => [
      k,
      { type: "list", items: "text", instructions: DATA_CLASSES[k].field },
    ]),
  );
}

/** Classes Clef thinks are present, strongest first. */
export function flaggedClasses(
  answers: DetectAnswers,
  threshold: number,
): DataClass[] {
  return CLASS_KEYS.filter((k) => answers[k].noul >= threshold).sort(
    (a, b) => answers[b].noul - answers[a].noul,
  );
}
