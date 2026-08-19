import { HttpError } from "./http";

export const TERMS_VERSION = "2026-08-19";
export const PRIVACY_VERSION = "2026-08-19";

export type LegalAcceptance = {
  termsVersion: string;
  privacyVersion: string;
};

export function readLegalAcceptance(body: unknown): LegalAcceptance {
  const payload = body as Record<string, unknown> | null | undefined;
  const termsVersion = payload?.accepted_terms_version;
  const privacyVersion = payload?.accepted_privacy_version;

  if (termsVersion !== TERMS_VERSION || privacyVersion !== PRIVACY_VERSION) {
    throw new HttpError(
      400,
      "Current Terms of Service and Privacy Policy must be accepted.",
    );
  }

  return { termsVersion, privacyVersion };
}
