# SlabPlan Access Review And Offboarding Procedure

Status: **draft procedure, not yet adopted.** The cadence and reviewer are
proposals until the owner adopts them. Record completed reviews in restricted
storage with the actual date, reviewer, findings and changes. Never backdate a
review. This repository is public: keep inventories and results out of it.

## Cadence (proposed)

- Quarterly for all providers below and for SlabPlan application administrators.
- Immediately when someone leaves, changes role, or loses a device holding a factor.
- After any security incident involving credentials or accounts.

## What to review

For each system, list every human and machine identity with administrative or
production-data access. Confirm it is still needed, that MFA is enforced where
the provider supports it, and that recovery options are current. Remove access
only after confirming it is unnecessary, and never disable a safeguard to make
automation easier.

| System | Identities to list | Check |
| --- | --- | --- |
| GitHub `tarobuild/slabplan` | Account owner, collaborators, installed GitHub Apps and OAuth apps with repository access, deploy keys, personal access tokens, Actions secrets and environments | 2FA enabled with recovery codes stored; no stale apps (retired Vercel/Railway integrations); tokens scoped and expiring; branch protection unchanged |
| Supabase (org `slabplan`) | Org members and roles, API keys, service-role key holders (Replit production secrets, GitHub Actions secrets) | MFA per member and org enforcement; keys rotated after any exposure; log retention and plan |
| Replit (`tarobuild/slabplan`) | Account and collaborators, deployment secret names | 2FA; only needed collaborators; secrets match the custody records |
| Stripe (`acct_1T4wiqGReLNurDCd`) | Team members and roles, restricted and secret keys, CLI keys, webhook endpoints | 2FA required; least-privilege restricted keys; expired CLI keys removed; only the SlabPlan webhook points at SlabPlan |
| Google Workspace / Google Cloud backup project | Super admins, backup project IAM, Workload Identity provider, budget recipients | 2-Step Verification enforced; only the backup service account can write; no service-account keys |
| macOS Keychain custody | `com.tarobuild.slabplan.account-security`, `com.tarobuild.slabplan.stripe-billing`, `com.tarobuild.slabplan.file-backup` | Entries present and owned by the owner; offline copies confirmed by the owner |
| SlabPlan application | Users with `admin` role or organization `owner`/`admin` membership | Each is expected, active, email-verified and MFA-enrolled; shared demo accounts remain limited to the synthetic demo organization |

Application administrator inventory (run read-only against production over a
certificate-verified connection; store the output privately):

```sql
select u.id, u.email, u.role, u.is_active, u.email_verified_at is not null as email_verified,
       u.mfa_enabled_at is not null as mfa_enabled, u.mfa_required,
       m.organization_id, m.role as organization_role
from users u
left join organization_memberships m on m.user_id = u.id and m.deleted_at is null
where u.deleted_at is null
  and (u.role = 'admin' or m.role in ('owner', 'admin'))
order by u.email;
```

## Offboarding checklist

1. Deactivate the SlabPlan user (this blocks sign-in, sessions, personal access tokens, uploads and signed file links).
2. Remove the person from GitHub, Supabase, Replit, Stripe, Google Workspace and the backup Google Cloud project.
3. Rotate any shared secret they could read, following the key-migration rules for encryption keys.
4. Transfer ownership of anything they owned (provider projects, billing, recovery email).
5. Record the date and every change in the restricted access-review log.

## Log retention inventory (to be verified per provider)

Retention differs by provider and plan. Record the verified value and its source
at each review instead of assuming defaults.

| Source | What it holds | Retention |
| --- | --- | --- |
| `security_events` table | Account-security events | At least 400 days (append-only trigger); included in daily backups |
| GitHub Actions logs | Backup, restore and CI runs | Verify the repository setting |
| GitHub account security log | Account sign-ins and settings changes | Verify in account settings |
| Supabase logs (API, database, auth) | Requests and database activity | Plan-dependent; verify in the project |
| Replit deployment logs | Application logs | Verify in the deployment |
| Stripe dashboard logs and events | API requests and webhook deliveries | Verify in the dashboard |
| Google Cloud audit logs (backup project) | Admin activity and Cloud Storage data access | Verify the log bucket retention |
