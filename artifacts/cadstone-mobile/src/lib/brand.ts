export const appBrand = {
  fullName: "SlabPlan",
  shortName: "SlabPlan",
} as const;

export const loginContent = {
  title: "Sign in",
  subtitle: `Welcome back to ${appBrand.fullName}.`,
  emailLabel: "Email",
  emailPlaceholder: "Enter your email",
  passwordLabel: "Password",
  passwordPlaceholder: "Password",
  submitLabel: "Sign in",
  missingTitle: "Missing sign in details",
  missingMessage: "Enter your email and password.",
  failedTitle: "Sign in failed",
  failedMessage: "Check the email and password, then try again.",
} as const;
