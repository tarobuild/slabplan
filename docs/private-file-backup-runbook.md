# SlabPlan Independent Private-File Backup Runbook

Last updated: 2026-09-28

Status: **implemented and tested in code; not operational until the
destination is provisioned, configured and a production run plus restore
drill have succeeded.** Do not describe this backup as operational before
that evidence exists.

This repository is public. Keep project IDs, bucket names, key IDs, run
evidence and access inventories in restricted evidence storage and GitHub
environment variables, not in this file.

## What it protects

Supabase remains the primary database and private file store. This job
creates an encrypted copy with a different provider (Google Cloud Storage in
a Taro Build-owned Google Cloud project), so a Supabase account, project or
bucket loss does not also destroy the recovery copy.

Each daily run copies:

- every object under `slabplan/uploads/` in the primary bucket (all tenant
  files, including legacy multipart manifests and parts);
- that day's logical database dump `backups/db/YYYY-MM-DD.sql.gz`, which holds
  the file metadata (`files` rows, organizations, users and all other tables).

Excluded: `*.cadstone-native` delivery copies. The application re-creates
them on demand from the multipart manifest and parts
(`prepareStoredFileForDelivery` in `artifacts/api-server/src/lib/storage.ts`).

Not covered: Supabase Auth and project settings, API keys and other secrets,
Replit configuration, and anything uploaded after the most recent successful
run. No recovery-time objective or near-zero data-loss claim is made.

## Design

| Property | Implementation |
| --- | --- |
| Scheduler | `.github/workflows/file-backup.yml`, daily 10:30 UTC, after the 09:00 UTC database dump |
| Source access | Existing `SUPABASE_*` repository secrets, read-only use |
| Destination credentials | Workload Identity Federation: short-lived tokens for one service account, only for `tarobuild/slabplan` (by numeric repository and owner id), environment `private-file-backup`, ref `refs/heads/main`. No service-account key exists. |
| Destination privileges | `roles/storage.objectCreator` and `roles/storage.objectViewer` on the one bucket. No delete, so the job cannot overwrite or remove backups. Uploads also use `ifGenerationMatch=0`. |
| Encryption | Client-side, before upload: segmented AES-256-GCM with a per-object HKDF-SHA256 key (`artifacts/api-server/scripts/lib/backup-crypto.mjs`). Segment order, truncation and extension are authenticated. Google also encrypts at rest. |
| Names | Destination object names are keyed HMAC digests. File names and organization ids appear only inside the encrypted manifest. |
| Integrity | SHA-256 of every plaintext object in the manifest; exact source size enforced before an upload is finalized; ciphertext MD5 compared with the stored object; every run hash-checks a random sample of ten restored objects. |
| Memory | Bounded streaming. Local synthetic tests: 1 GiB and 4 GiB objects round-tripped with matching SHA-256 at about 228 MiB and 233 MiB peak process RSS (fake provider in the same process). This is not a provider throughput or 50+ GiB measurement. |
| Incremental | Unchanged object versions are carried forward from the previous manifest. Changed objects create a new immutable version. |
| Recovery coverage | Listing is not treated as proof of recoverability. Objects stored as legacy multipart manifests are recognized with the application's own rules (manifest content type, or an undeclared body of at most 1 MiB that parses as a valid manifest for its own path). Each run records every part and fails, as `partial`, when a part is missing, has a different size, points outside the file's own `.parts/` path (and therefore outside its organization) or when a declared manifest cannot be read. Carried-forward files are re-checked on every run. |
| Cost bounds | `FILE_BACKUP_MAX_NEW_BYTES` (default 100 GiB copied per run; excess is deferred and the run fails for review), `FILE_BACKUP_MAX_OBJECTS` (default 250,000), a Google Cloud budget alert, and operator-run pruning. |
| Alerts | A failed or partial run fails the workflow, which opens or updates a GitHub issue and emails `SECURITY_ALERT_EMAIL` through `/api/internal/backup-alert`. The email's subject is "SlabPlan scheduled backup needs attention". The same wording is used for any scheduled backup, so open the linked workflow run to see which backup failed. Missing configuration also fails loudly. |
| Public logs | The repository is public, so workflow logs show only run id, key id, status, failure/deferral counts and redacted failure reasons. Counts and sizes stay in the private run summary. |

Destination layout (under the configured root, default
`slabplan-file-backup/v1`):

```
blobs/<aa>/<digest>              encrypted object versions (create-only)
manifests/<runId>.ndjson.spfb    encrypted manifest: name, organization, size, SHA-256, content type
runs/<runId>.json                private run summary: status, counts, sizes, key id (written last)
```

## Ownership and access (to be completed at provisioning)

Record these in restricted evidence storage, not here:

- Google Cloud organization/project and billing account, and who owns them.
- Human principals with project or bucket access and their MFA status.
- Service account email and Workload Identity pool/provider resource name.
- Bucket name, location, retention period and soft-delete period.
- Budget amount and alert recipients.

Only project owners should hold delete or retention-policy permissions.
Review this access in the quarterly access review.

## Encryption key custody

`FILE_BACKUP_ENCRYPTION_KEY` is 32 random bytes as 64 hex characters.
Without it, the backups cannot be read. Keep exactly these copies:

1. macOS Keychain service `com.tarobuild.slabplan.file-backup`, account
   `slabplan-production` on the owner's administrator Mac.
2. GitHub environment secret `FILE_BACKUP_ENCRYPTION_KEY` in environment
   `private-file-backup` (write-only; GitHub cannot display it again).
3. An offline or password-manager copy controlled by the owner, stored apart
   from the Mac. This is an owner action and must be confirmed by the owner.

`FILE_BACKUP_EXPECTED_KEY_ID` (16 hex characters, not secret) guards against
configuring the wrong key. Never print, paste into chat, commit or pass the key
as a command-line argument. Generate and move it only through stdin pipes.

Rotation: generate a new key, set a new `FILE_BACKUP_DEST_ROOT` (for example
`slabplan-file-backup/v2`) and key id together, and keep the previous key until
every backup under the previous root has been pruned. The tools refuse to mix
keys within one root.

## Retention

- Bucket retention policy: 30 days. No object, including manifests, can be
  deleted or replaced during that time. The policy is not locked; locking is
  irreversible and is an owner decision.
- Soft delete: Google's default seven-day soft-delete window is kept.
- Pruning (operator only, with the operator's own Google login; the backup
  service account cannot delete): keep the newest 14 runs and every run from
  the last 90 days, and remove blobs referenced by none of them.

```
pnpm --filter @workspace/api-server run restore:files prune --keep-days 90 --keep-runs 14
pnpm --filter @workspace/api-server run restore:files prune --keep-days 90 --keep-runs 14 --apply
```

Deleted customer files therefore remain recoverable for at least 90 days
after deletion from Supabase, then are removed at the next prune. Align this
with the customer data-retention commitments before relying on it.

## Restore procedures

Operator environment for local commands: `FILE_BACKUP_GCS_BUCKET`,
`FILE_BACKUP_ENCRYPTION_KEY` (read from Keychain into the environment without
printing), `FILE_BACKUP_EXPECTED_KEY_ID`, and `gcloud auth login` as an
authorized principal (or `GCS_IMPERSONATE_SERVICE_ACCOUNT`). Every command
verifies each object's SHA-256 against the manifest and never overwrites.

```
# Private run summary (counts and sizes; operator terminal only)
pnpm --filter @workspace/api-server run restore:files summary --run latest

# Hash-check a sample, also comparing with the current primary objects
pnpm --filter @workspace/api-server run restore:files verify --run latest --sample 25 --compare-source

# Restore one tenant to a local directory (files 0600, directories 0700)
pnpm --filter @workspace/api-server run restore:files restore --run latest --organization <organization-id> --to-dir <empty-directory>

# Restore into a new or drill Supabase bucket (RESTORE_TARGET_SUPABASE_URL,
# RESTORE_TARGET_SUPABASE_STORAGE_BUCKET, RESTORE_TARGET_SUPABASE_SERVICE_ROLE_KEY)
pnpm --filter @workspace/api-server run restore:files restore --run latest --all --to-supabase

# Database dump from the same run
pnpm --filter @workspace/api-server run restore:files db-dump --run latest --to <path>.sql.gz
```

Restoring into the primary bucket is refused unless `--allow-primary-target`
is passed during an approved incident. The primary is identified from the
run's authenticated manifest (project host and bucket recorded at backup
time), and also from any `SUPABASE_*` variables in the operator environment; a
run without a recorded identity is refused. Always give the target as its
canonical `https://<project-ref>.supabase.co` URL, because a custom-domain
alias of the primary cannot be recognized.

`--to-dir` must be a real directory owned by the operator and not writable by
other users. The same applies to every directory that already exists beneath
it, checked before anything is downloaded. Every parent of the root must be
owned by the operator or by root and must not be writable by other users,
unless it carries the sticky bit as `/tmp` does. Symbolic links at the root,
in any intermediate directory or at a file name are refused or skipped, and
every file is published with an exclusive create plus a containment check.
Trust assumption: the operator's own account is trusted. These checks keep
other accounts from redirecting a restore, but they do not defend against a
hostile process running as the operator. Large objects restored with
`--to-supabase` use a single streamed request; restore very large files to a
directory and re-upload them through the resumable path if needed.

After a whole-project restore, reapply database privileges and storage
policies (see the Data API containment record) and follow
`docs/supabase-backup-restore-runbook.md`.

## Restore drill

Both layers check recovery coverage: the daily backup rejects incomplete
multipart files at backup time, and the drill checks again against the
restored database. A file row counts as covered only when its object was
backed up for the same organization at the row's size: an ordinary object must
match the row exactly, and a multipart file must declare that total with every
part present in the same run. Rows without a recorded size are reported, not
assumed to match. The drill resolves `latest` once, validates the id and uses
that one run for every step, so a backup finishing mid-drill cannot mix
snapshots. The daily job verifies the run it just wrote, read from its own
private summary.

`.github/workflows/file-restore-drill.yml` (manual) uses only the
independent copy to verify a random sample against the primary, restore the
run's database dump into a disposable PostgreSQL 17 database, check that every
live `files` row has a backed-up object bound to the same organization, and
optionally restore one organization's files on the runner.

The database step (`artifacts/api-server/scripts/file-backup-db-verify.mjs`,
shared with the existing database drill through `scripts/lib/pg-restore.mjs`)
fails closed. Every psql error line is examined and any error outside the
explicit Supabase Vault allow-list fails. So do a non-zero psql exit, a
damaged dump, a missing table that the dump's own applied migrations create,
an empty `organizations`, `users` or migration ledger, and an applied
migration unknown to the repository. Intentional `NOT VALID` tenant foreign
keys (migration 0033) are preserved rather than flagged. Do not widen the
allow-list to make a drill pass; investigate the error first.

```
RESTORE_ADMIN_DATABASE_URL=<disposable server> \
  node artifacts/api-server/scripts/file-backup-db-verify.mjs --dump <path>.sql.gz
``` Proposed cadence:
after provisioning, after any backup code change, and quarterly. Retain the run
link and outcome in restricted evidence storage.

## Provisioning (one time)

Run with an authorized Google login, then revoke it. Values in angle brackets
are recorded privately.

```
gcloud projects create <project-id> --name="SlabPlan file backup"
gcloud billing projects link <project-id> --billing-account=<billing-account-id>
gcloud services enable storage.googleapis.com iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com billingbudgets.googleapis.com --project=<project-id>

gcloud storage buckets create gs://<bucket> --project=<project-id> --location=us-central1 \
  --default-storage-class=STANDARD --uniform-bucket-level-access --public-access-prevention \
  --retention-period=30d

gcloud iam service-accounts create slabplan-file-backup --project=<project-id> \
  --display-name="SlabPlan file backup (GitHub Actions)"
gcloud storage buckets add-iam-policy-binding gs://<bucket> \
  --member=serviceAccount:slabplan-file-backup@<project-id>.iam.gserviceaccount.com --role=roles/storage.objectCreator
gcloud storage buckets add-iam-policy-binding gs://<bucket> \
  --member=serviceAccount:slabplan-file-backup@<project-id>.iam.gserviceaccount.com --role=roles/storage.objectViewer

gcloud iam workload-identity-pools create github --project=<project-id> --location=global \
  --display-name="GitHub Actions"
gcloud iam workload-identity-pools providers create-oidc slabplan --project=<project-id> \
  --location=global --workload-identity-pool=github --display-name="tarobuild/slabplan backup" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.environment=assertion.environment,attribute.ref=assertion.ref" \
  --attribute-condition="assertion.repository_id == '1241085870' && assertion.repository_owner_id == '282974962' && assertion.environment == 'private-file-backup' && assertion.ref == 'refs/heads/main'"
gcloud iam service-accounts add-iam-policy-binding \
  slabplan-file-backup@<project-id>.iam.gserviceaccount.com --project=<project-id> \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/<project-number>/locations/global/workloadIdentityPools/github/attribute.repository_id/1241085870"

gcloud billing budgets create --billing-account=<billing-account-id> \
  --display-name="SlabPlan file backup" --budget-amount=25USD \
  --filter-projects=projects/<project-id> \
  --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0
```

Also enable Cloud Audit Logs Data Access (read and write) for Cloud Storage in
the project so backup reads are attributable.

GitHub (repository administrator):

1. Create environment `private-file-backup`, restricted to the `main` branch.
2. Add environment secret `FILE_BACKUP_ENCRYPTION_KEY` from Keychain via stdin.
3. Add environment variables `FILE_BACKUP_GCS_BUCKET`,
   `FILE_BACKUP_EXPECTED_KEY_ID`, `FILE_BACKUP_WIF_PROVIDER`
   (`projects/<project-number>/locations/global/workloadIdentityPools/github/providers/slabplan`)
   and `FILE_BACKUP_SERVICE_ACCOUNT`.
4. After merge, run the workflow manually, then run the restore drill, and
   record both run links privately.

## Evidence checklist before calling this operational

- [ ] Destination ownership, access, MFA and budget recorded privately.
- [ ] Key custody confirmed in all three locations (owner confirms offline copy).
- [ ] First production run `complete`, with the random sample verified.
- [ ] Restore drill passed: sample matched primary, database dump restored,
      file rows bound to backed-up objects, one organization restored.
- [ ] Failure alert path exercised (GitHub issue and email received).

## References

- Resumable uploads: https://docs.cloud.google.com/storage/docs/performing-resumable-uploads
- Retention policies and Bucket Lock: https://cloud.google.com/storage/docs/bucket-lock
- Soft delete: https://cloud.google.com/storage/docs/soft-delete
- GitHub Workload Identity Federation: https://github.com/google-github-actions/auth
- GitHub OIDC claims: https://docs.github.com/en/actions/security-for-github-actions/security-hardening-your-deployments/about-security-hardening-with-openid-connect
