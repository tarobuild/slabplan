import nodemailer from "nodemailer";
import { logger } from "./logger";

/**
 * Transactional email service.
 *
 * Production delivery uses standard SMTP so SlabPlan can send through the
 * owner's Google Workspace account without coupling auth to a marketing-email
 * vendor. Tests can replace the sender via `__setEmailSenderForTests`.
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
  expiresIn?: string;
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
    html: string;
    tag: "invite" | "password-reset";
  }): Promise<SentMessage>;
};

export type SmtpEmailConfig = {
  host: string;
  port: number;
  secure: boolean;
  requireTls: boolean;
  user: string;
  password: string;
  fromEmail: string;
  fromName: string;
};

type MailTransport = {
  sendMail(options: {
    from: { name: string; address: string };
    to: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<{ messageId?: string }>;
};

let testSender: EmailSender | null = null;
let productionSender: EmailSender | null = null;

function requiredEnv(env: NodeJS.ProcessEnv, names: readonly string[]): string {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  throw new Error(`${names.join(" or ")} is required for transactional email.`);
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value?.trim()) return fallback;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw new Error(
    `Expected a boolean value, received ${JSON.stringify(value)}.`,
  );
}

export function readSmtpEmailConfig(
  env: NodeJS.ProcessEnv = process.env,
): SmtpEmailConfig {
  const provider = env.EMAIL_PROVIDER?.trim().toLowerCase() || "smtp";
  if (provider !== "smtp") {
    throw new Error(`Unsupported EMAIL_PROVIDER ${JSON.stringify(provider)}.`);
  }

  const portValue = env.SMTP_PORT?.trim() || "465";
  const port = Number(portValue);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("SMTP_PORT must be an integer between 1 and 65535.");
  }

  const user = requiredEnv(env, ["SMTP_USER"]);
  return {
    host: requiredEnv(env, ["SMTP_HOST"]),
    port,
    secure: parseBoolean(env.SMTP_SECURE, port === 465),
    requireTls: parseBoolean(env.SMTP_REQUIRE_TLS, port !== 465),
    user,
    password: requiredEnv(env, ["SMTP_PASSWORD", "SMTP_PASS"]),
    fromEmail: env.SMTP_FROM_EMAIL?.trim() || user,
    fromName: env.SMTP_FROM_NAME?.trim() || "SlabPlan",
  };
}

export function assertProductionEmailConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (env.NODE_ENV === "production") readSmtpEmailConfig(env);
}

export function createSmtpEmailSender(
  config: SmtpEmailConfig,
  transport?: MailTransport,
): EmailSender {
  const mailer =
    transport ??
    (nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      requireTLS: config.requireTls,
      auth: { user: config.user, pass: config.password },
      tls: { minVersion: "TLSv1.2" },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    }) as MailTransport);

  return {
    async send({ to, subject, text, html }) {
      const result = await mailer.sendMail({
        from: { name: config.fromName, address: config.fromEmail },
        to,
        subject,
        text,
        html,
      });
      return { id: result.messageId || "smtp-accepted" };
    },
  };
}

function getProductionSender(): EmailSender {
  if (!productionSender) {
    productionSender = createSmtpEmailSender(readSmtpEmailConfig());
  }
  return productionSender;
}

function getSender(): EmailSender {
  return testSender ?? getProductionSender();
}

/**
 * Replace the email sender with a stub. Returns the previous sender so
 * tests can restore it. **Never call this from production code.**
 */
export function __setEmailSenderForTests(
  stub: EmailSender | null,
): EmailSender | null {
  const previous = testSender;
  testSender = stub;
  return previous;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function buildEmailHtml(params: {
  heading: string;
  greeting: string;
  paragraphs: string[];
  actionLabel: string;
  actionUrl: string;
}): string {
  const paragraphs = params.paragraphs
    .map(
      (paragraph) =>
        `<p style="margin:0 0 16px;color:#334155;line-height:1.65">${escapeHtml(paragraph)}</p>`,
    )
    .join("");
  return `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif"><div style="padding:32px 16px"><div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0"><div style="padding:28px 32px;border-bottom:4px solid #f97316"><strong style="font-size:20px;color:#0f172a">SlabPlan</strong></div><div style="padding:32px"><h1 style="margin:0 0 20px;font-size:24px;color:#0f172a">${escapeHtml(params.heading)}</h1><p style="margin:0 0 16px;color:#334155;line-height:1.65">${escapeHtml(params.greeting)}</p>${paragraphs}<p style="margin:24px 0"><a href="${escapeHtml(params.actionUrl)}" style="display:inline-block;background:#0f172a;color:#ffffff;padding:12px 18px;text-decoration:none;font-weight:700">${escapeHtml(params.actionLabel)}</a></p><p style="margin:24px 0 0;color:#64748b;font-size:13px;line-height:1.6">If the button does not work, paste this address into your browser:<br><a href="${escapeHtml(params.actionUrl)}" style="color:#c2410c;word-break:break-all">${escapeHtml(params.actionUrl)}</a></p></div></div></div></body></html>`;
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
  const html = buildEmailHtml({
    heading: "Your SlabPlan account is ready",
    greeting,
    paragraphs: [
      `${params.inviterName} has set up an account for you on SlabPlan.`,
      "Use the secure link below to set your password. It expires in 7 days and can only be used once.",
    ],
    actionLabel: "Set password",
    actionUrl: params.inviteLink,
  });
  return { subject, text, html };
}

function buildPasswordResetEmail(params: SendPasswordResetParams) {
  const expiresIn = params.expiresIn ?? "1 hour";
  const subject = "Reset your SlabPlan password";
  const text = [
    "Hi,",
    "",
    "We received a request to reset the password for your SlabPlan account.",
    "Use the link below to choose a new password:",
    "",
    params.resetLink,
    "",
    `This link expires in ${expiresIn} and can only be used once. If you didn't request a reset, you can safely ignore this email.`,
    "",
    "— SlabPlan",
  ].join("\n");
  const html = buildEmailHtml({
    heading: "Reset your SlabPlan password",
    greeting: "Hi,",
    paragraphs: [
      "We received a request to reset the password for your SlabPlan account.",
      `Use the secure link below to choose a new password. It expires in ${expiresIn} and can only be used once.`,
    ],
    actionLabel: "Reset password",
    actionUrl: params.resetLink,
  });
  return { subject, text, html };
}

export async function sendInvite(
  params: SendInviteParams,
): Promise<SentMessage> {
  const { subject, text, html } = buildInviteEmail(params);
  const sender = getSender();
  try {
    const sent = await sender.send({
      to: params.to,
      subject,
      text,
      html,
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
  const { subject, text, html } = buildPasswordResetEmail(params);
  const sender = getSender();
  try {
    const sent = await sender.send({
      to: params.to,
      subject,
      text,
      html,
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
