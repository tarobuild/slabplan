# Task #346 — Operational evidence

Captured at task completion against the dev DB (Helium / Supabase pg17).

## post-merge.log

End-to-end run of `bash scripts/post-merge.sh` after the cutover:

- `check-migrations-journal` reports 17 SQL files match 17 journal
  entries (tags, idxs, sha256 checksums all clean).
- `migrate` reports "No pending migrations." (steady state — the runner
  baselined `0000` and applied `0004-0018` in a prior run; this run
  proves idempotency).
- No `rate_limit_buckets` / "relation does not exist" warning is
  produced. `grep -i "rate_limit\|relation does not exist"` over the log
  returns nothing.

## verify-schema-parity-migrate-vs-push.log

`pnpm --filter @workspace/db verify-schema-parity` against scratch
databases on the dev Supabase server. Final line:

```
OK: migrate-built and push-built schemas are byte-equal after normalization.
```

The full normalized dumps and `diff.txt` for each run are written to
`.local/state/schema-parity/<timestamp>-migrate-vs-push/` (gitignored;
inspect locally for an audit).

## verify-schema-parity-dev-vs-prod.log

`pnpm --filter @workspace/db verify-schema-parity --mode=dev-vs-prod`.
The script is read-only on both ends and requires `PROD_DATABASE_URL`.
This environment does not have prod credentials configured, so the run
exits cleanly with:

```
PROD_DATABASE_URL is not set; skipping dev-vs-prod comparison.
```

The dev-vs-prod comparison is the responsibility of the downstream
"Launch readiness verification + checklist" task, which has prod access.
The tooling is in place; only the credentials are missing here.
