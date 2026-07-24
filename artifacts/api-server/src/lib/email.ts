import { logger } from "./logger";

/**
 * Transactional email service.
 *
 * No production provider is wired in this codebase. Repository policy
 * explicitly excludes the previously proposed provider, and there is no other
 * approved provider dependency here. Tests can stub the sender via
 * `__setEmailSenderForTests`.
 * In production, sends throw loudly so callers can surface delivery failure
 * and provide the manual invite/reset link instead of silently no-oping.
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

const productionSender: EmailSender = {
  async send({ tag }) {
    throw new Error(
      `Transactional email provider is not configured for ${tag}; configure an approved provider before enabling automatic email delivery.`,
    );
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
  const subject = `${params.inviterName} invited you to SlabPlan`;
  const text = [
    greeting,
    "",
    `${params.inviterName} has set up an account for you on SlabPlan.`,
    "Use the link below to set your password and sign in:",
    "",
    params.inviteLink,
    "",
    "This link expires in 7 days and can only be used once. If you weren't expecting this, you can safely ignore this email.",
    "",
    "— SlabPlan",
  ].join("\n");
  return { subject, text };
}

function buildPasswordResetEmail(params: SendPasswordResetParams) {
  const subject = "Reset your SlabPlan password";
  const text = [
    "Hi,",
    "",
    "We received a request to reset the password for your SlabPlan account.",
    "Use the link below to choose a new password:",
    "",
    params.resetLink,
    "",
    "This link expires in 7 days and can only be used once. If you didn't request a reset, you can safely ignore this email.",
    "",
    "— SlabPlan",
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
