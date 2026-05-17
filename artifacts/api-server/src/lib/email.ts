import { Resend } from "resend";
import { logger } from "./logger";
import { APP_NAME } from "./brand";

/**
 * Transactional email service.
 *
 * Uses Resend (https://resend.com) under the hood — picked over SendGrid for
 * the simpler API and generous free tier on a 5-user internal tool. The
 * provider client is constructed lazily so unit tests can stub the sender
 * via `__setEmailSenderForTests` without ever requiring `RESEND_API_KEY`
 * to be set in the test environment.
 *
 * Required env vars in production:
 *   - `RESEND_API_KEY` — the Resend API key (set via Replit secrets).
 *   - `EMAIL_FROM`     — the verified "From" address, e.g.
 *                        `Stone Track <noreply@mail.example.com>`.
 *
 * Optional:
 *   - `EMAIL_REPLY_TO` — defaults to unset.
 *
 * Both `sendInvite` and `sendPasswordReset` throw on failure so the caller
 * can surface a clear error to the admin (and we never silently no-op).
 */

export type SendInviteParams = {
  to: string;
  inviteLink: string;
  inviterName: string;
  inviteeName?: string;
};

export type SendPasswordResetParams = {
  to: string;
  resetLink: string;
};

export type SentMessage = {
  /** Provider message id (or "test-stub" when stubbed). */
  id: string;
};

export type EmailSender = {
  send(params: {
    to: string;
    subject: string;
    text: string;
    tag: "invite" | "password-reset";
  }): Promise<SentMessage>;
};

let testSender: EmailSender | null = null;
let resendClient: Resend | null = null;

function getResend(): Resend {
  if (resendClient) return resendClient;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error(
      "RESEND_API_KEY is not configured. Add the secret in Replit and redeploy.",
    );
  }
  resendClient = new Resend(apiKey);
  return resendClient;
}

function getFromAddress(): string {
  const from = process.env.EMAIL_FROM?.trim();
  if (!from) {
    throw new Error(
      "EMAIL_FROM is not configured. Set it to a verified sender, e.g. 'Stone Track <noreply@mail.example.com>'.",
    );
  }
  return from;
}

const productionSender: EmailSender = {
  async send({ to, subject, text, tag }) {
    const resend = getResend();
    const from = getFromAddress();
    const replyTo = process.env.EMAIL_REPLY_TO?.trim() || undefined;

    const result = await resend.emails.send({
      from,
      to,
      subject,
      text,
      replyTo,
      tags: [{ name: "category", value: tag }],
    });

    if (result.error) {
      throw new Error(
        `Resend rejected the message (${result.error.name ?? "unknown"}): ${result.error.message ?? "no detail"}`,
      );
    }

    if (!result.data?.id) {
      throw new Error("Resend returned no message id; treating as failure.");
    }

    return { id: result.data.id };
  },
};

function getSender(): EmailSender {
  return testSender ?? productionSender;
}

/**
 * Replace the email sender with a stub. Returns the previous sender so
 * tests can restore it. **Never call this from production code.**
 */
export function __setEmailSenderForTests(stub: EmailSender | null): EmailSender | null {
  const previous = testSender;
  testSender = stub;
  return previous;
}

function buildInviteEmail(params: SendInviteParams) {
  const greeting = params.inviteeName ? `Hi ${params.inviteeName},` : "Hi,";
  const subject = `${params.inviterName} invited you to ${APP_NAME}`;
  const text = [
    greeting,
    "",
    `${params.inviterName} has set up an account for you on ${APP_NAME}.`,
    "Use the link below to set your password and sign in:",
    "",
    params.inviteLink,
    "",
    "This link expires in 7 days and can only be used once. If you weren't expecting this, you can safely ignore this email.",
    "",
    `- ${APP_NAME}`,
  ].join("\n");
  return { subject, text };
}

function buildPasswordResetEmail(params: SendPasswordResetParams) {
  const subject = `Reset your ${APP_NAME} password`;
  const text = [
    "Hi,",
    "",
    `We received a request to reset the password for your ${APP_NAME} account.`,
    "Use the link below to choose a new password:",
    "",
    params.resetLink,
    "",
    "This link expires in 7 days and can only be used once. If you didn't request a reset, you can safely ignore this email.",
    "",
    `- ${APP_NAME}`,
  ].join("\n");
  return { subject, text };
}

export async function sendInvite(params: SendInviteParams): Promise<SentMessage> {
  const { subject, text } = buildInviteEmail(params);
  const sender = getSender();
  try {
    const sent = await sender.send({
      to: params.to,
      subject,
      text,
      tag: "invite",
    });
    logger.info(
      { to: params.to, messageId: sent.id, inviter: params.inviterName },
      "[email] invite sent",
    );
    return sent;
  } catch (err) {
    logger.error(
      { to: params.to, err: (err as Error)?.message },
      "[email] invite send failed",
    );
    throw err;
  }
}

export async function sendPasswordReset(
  params: SendPasswordResetParams,
): Promise<SentMessage> {
  const { subject, text } = buildPasswordResetEmail(params);
  const sender = getSender();
  try {
    const sent = await sender.send({
      to: params.to,
      subject,
      text,
      tag: "password-reset",
    });
    logger.info(
      { to: params.to, messageId: sent.id },
      "[email] password reset sent",
    );
    return sent;
  } catch (err) {
    logger.error(
      { to: params.to, err: (err as Error)?.message },
      "[email] password reset send failed",
    );
    throw err;
  }
}

/** Truncate a provider error string so it fits in the 500-char DB column. */
export function truncateEmailError(message: string): string {
  if (message.length <= 500) return message;
  return `${message.slice(0, 497)}...`;
}
