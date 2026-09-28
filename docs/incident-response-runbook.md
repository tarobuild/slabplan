# SlabPlan Security Incident Response Runbook

Status: **draft procedure, not yet adopted by management.** Named roles below
are proposals until the owner assigns and records them. This repository is
public: keep incident facts, customer details, logs and evidence in restricted
storage, never in GitHub issues, pull requests or this file.

## Roles (proposed)

| Role | Responsibility | Proposed holder |
| --- | --- | --- |
| Incident lead | Declares, coordinates, decides containment, keeps the timeline | Owner (Taro Build) |
| Technical responder | Investigates, contains, restores, preserves evidence | Owner or an engineer the owner designates |
| Communications and legal | Decides customer, regulator and partner notices with counsel | Owner with outside counsel |

An automated agent may assist with investigation and containment only within
the owner's documented approval. It must not decide notification obligations
or declare an incident closed.

## Severity

| Level | Examples | Target response |
| --- | --- | --- |
| SEV-1 | Confirmed access to customer data by an unauthorized party; production credential known to be exposed; production unavailable | Start immediately; contain within hours |
| SEV-2 | Exposure that could allow customer-data access but no evidence of use (misconfigured access, leaked non-production credential with production reuse unknown); backup or alerting failure over 24 hours | Start the same day |
| SEV-3 | Suspicious activity without an exposure path; failed security control with compensating controls | Within 2 business days |

Response targets are proposals. Do not publish them as commitments until adopted.

## Detection sources

- Provider security notices sent to the business inbox (for example Supabase advisories, GitHub secret-scanning alerts, Stripe or Google notices).
- GitHub issues titled "Scheduled backup needs attention" or "Scheduled private-file backup needs attention", and the matching email to `SECURITY_ALERT_EMAIL`.
- `security_events` (account-security events: MFA failures, recovery-code use, session revocations) and application logs in Replit.
- Customer or staff reports.

## Procedure

1. **Declare and record.** Open a restricted incident record: detection time (UTC), source, reporter, initial severity. Record every later action with an actual timestamp. Never backdate.
2. **Preserve evidence before changing anything.** Save provider audit and request logs, affected configuration (ACLs, grants, secret *names*), and relevant `security_events` rows to restricted storage. Note each provider's log retention, because older evidence may already be gone.
3. **Contain with the smallest reversible change.**
   - Exposed database access path: revoke client-role grants, enable RLS, and restrict default privileges transactionally. Save the prior ACLs first and never restore public access to fix an application error.
   - Leaked or suspect credential: rotate at the issuing provider, update every place it is stored (Replit production secrets, GitHub Actions secrets or environments, macOS Keychain custody records), republish, and confirm the old value is rejected. Rotation of `ACCOUNT_SECURITY_ENCRYPTION_KEY` or `FILE_BACKUP_ENCRYPTION_KEY` requires the documented key-migration procedures, never a blind replacement.
   - Compromised user account: the user can revoke all of their sessions with `POST /api/auth/security/revoke-sessions`. An administrator can deactivate the account, which blocks sign-in and rejects its existing sessions (covered by `deactivation-lockout.test.ts`). Then reset the password, re-enroll MFA and revoke personal access tokens.
   - Data loss or corruption: stop writes if needed; restore into an isolated environment first (`docs/supabase-backup-restore-runbook.md`, `docs/private-file-backup-runbook.md`); never restore over production without an explicit incident decision.
4. **Investigate scope.** Establish the exposure window, what was reachable, and what the logs show about actual access. State what the evidence cannot show (for example requests older than log retention). Do not conclude "no access occurred" from missing logs.
5. **Decide notifications** with counsel, using the facts and their limits: which customers, individuals, partners or authorities, and deadlines under applicable law and contracts. Record the decision and its basis.
6. **Recover and verify.** Confirm containment with a negative test (for example an anonymous request now denied), run application smoke checks, and watch for recurrence.
7. **Review.** Within two weeks, record root cause, contributing factors, what worked, and dated follow-up actions with owners. Link the restricted record from the access-review log.

## Exercises

Run a tabletop at least annually and after material architecture changes.
Suggested scenarios: an exposed Data API table on a non-production project;
a leaked service-role key; loss of the primary Supabase project with recovery
from the independent backup; a compromised administrator account. Record date,
participants, decisions and gaps. A document review or an automated drill is
not a tabletop with the responsible people.

## Contacts and access (restricted)

Keep provider support paths, account recovery methods and emergency contacts in
restricted storage. The owner must be able to reach GitHub, Supabase, Replit,
Stripe, Google Workspace and the backup Google Cloud project with MFA from more
than one enrolled device or with stored recovery codes.
