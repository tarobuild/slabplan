# Account Security Operations

## Release Gate

This change is not a SOC 2 attestation. Keep production enrollment closed if
its encryption secret or transactional email transport is unavailable.

1. Preserve a current database backup and verify the restore procedure.
2. Generate `ACCOUNT_SECURITY_ENCRYPTION_KEY` from 32 cryptographically random
   bytes, encoded as 64 hex characters. Store it in Replit published secrets
   and a restricted organizational password manager, outside the database.
   Never log, commit, or place the key in a browser-accessible environment.
3. Apply additive migration `0042_account_security` through the migration
   runner. Do not rewrite previously applied migration checksums.
4. Deploy the exact reviewed GitHub revision and verify the reported release.
5. Exercise registration, real email delivery, single-use verification,
   authenticator enrollment, recovery-code storage, sign-in, and checkout.
   Use an isolated TEST account; do not alter customer authentication factors.
6. Confirm old sessions, old challenges and API tokens are rejected after
   account-wide revocation. Confirm password reset still requires the factor.

## Enforcement Scope

New public workspace owners must verify their email and enroll an authenticator
before subscription checkout. Existing accounts are not silently marked verified
or forced into an unannounced lockout. They can verify email and enroll under
Settings > Account security. Invitations prove mailbox access when their
single-use password setup link is consumed; invited users are not automatically
subject to an organization-wide MFA policy.

Every enrolled user's application session must carry factor verification.
Provider password authentication is exchanged for an application session; raw
provider tokens cannot bypass an enrolled factor. Account-wide sign-out revokes
all application sessions and personal access tokens. It does not remotely sign
out the operator's Replit, Google, GitHub or Supabase administrative accounts.

Enrollment secrets are AES-256-GCM encrypted with user-bound associated data.
Recovery codes and email/challenge tokens are stored as hashes. A challenge
expires after ten minutes and is invalidated after five failures; email links
expire after one hour. Recovery codes are single-use and shown once.

## Recovery And Key Handling

- Users should keep recovery codes in their own password manager. Shared demo
  credentials and shared authenticators are not a customer account model.
- Never remove MFA solely on a password-reset email, chat message, caller ID,
  or a matching company name. Escalate lost-factor-and-code recovery to the
  security owner for documented independent identity verification.
- There is no automated administrator override or self-service factor removal
  in this release. Do not tell customers otherwise. Account recovery and key
  rotation require a reviewed, scoped operational change with an audit record.
- Losing the encryption key makes existing factors unreadable. Restore the
  original key from restricted custody; do not replace it with a fresh value.
- A key compromise requires containment, a scoped re-encryption/enrollment plan,
  revocation of affected sessions, and preservation of investigation evidence.
- Do not roll back to a pre-MFA application version after customers enroll:
  an older binary would not enforce these controls. Prefer a forward fix.

## Backup Failure Alerts

The daily GitHub Actions backup runs independently of Replit web autoscaling.
On failure, its alert job creates or updates a repository issue with only the
workflow link and requests an email through the existing SMTP transport.
Configure `SECURITY_ALERT_EMAIL`, `SECURITY_ALERT_REPOSITORY`, and the matching
`BACKUP_TRIGGER_SECRET` in production. `BACKUP_WEBHOOK_URL` in GitHub must target
the application's HTTPS origin. Missing configuration or delivery failure is a
failed alert job, never a successful notification.

Use the authenticated `/api/internal/backup-alert` endpoint with a valid
repository workflow `runUrl` and `test: true` for a clearly identified delivery
test. A successful HTTP response proves SMTP acceptance, not inbox receipt.
Record receipt separately. Email delivery depends on the application and SMTP;
the GitHub failure record is the independent fallback, not an independent email
service. Never put dump contents, customer records or credentials in the public
repository issue.

## Evidence Still Required

Application features do not prove provider MFA, personnel training, device
encryption, approved policies, independent review, penetration testing, or
ongoing incident handling. Keep evidence in restricted storage. Management and
the independent CPA determine examination scope and the observation period.
