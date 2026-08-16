# Anwar large-upload root cause and durable repair — 2026-08-16

## Customer symptom

Anwar could select legitimate project packages, PDFs, archives, photos, and
videos, but uploads well below the app's advertised 2 GB limit failed. The UI
could report that a roughly 80–200 MB file exceeded 2 GB even though it did
not. Retrying on another browser or Windows laptop did not make the path
reliable.

## Root cause

Three independent ceilings were being presented as one:

1. The browser sent large files to the CAD Stone API in chunks, but every byte
   still crossed the Replit/Cloud Run service and was assembled on Replit's
   temporary disk before being uploaded again to storage.
2. The Supabase project's global Storage limit and the `cadstone-files` bucket
   limit were still near their default 50 MB setting. Storage rejected larger
   objects even though the app advertised 2 GB.
3. The storage rejection mapper rendered the app's configured ceiling instead
   of the provider's effective ceiling, producing the false “over 2 GB”
   explanation.

Raising only the displayed limit or only the bucket limit would leave the
Replit bandwidth, request-timeout, and temporary-disk bottlenecks in place.

## Implemented architecture

Files above the proxy-safe threshold, plus photo/video uploads, now use
Supabase's hosted TUS resumable endpoint directly from the browser:

1. The authenticated CAD Stone API rechecks destination permissions, filename,
   declared size, dangerous-extension blocklist, and duplicate context.
2. The API creates a new random object path and mints a two-hour,
   object-scoped Supabase upload signature. The Supabase service-role key is
   never sent to the browser.
3. `tus-js-client` uploads browser-to-Supabase in provider-recommended 6 MiB
   chunks with progress, bounded retries, interruption recovery, and a
   24-hour upload URL. The scoped CAD Stone intent is cached for seven days,
   letting a hard refresh or browser restart re-sign and resume the same unique
   object path instead of silently creating an unrelated upload. If the
   two-hour upload signature expires during a long active transfer, the client
   automatically re-signs and resumes after the last confirmed TUS offset;
   repeated authorization failures without forward progress stop instead of
   looping.
4. Upsert is deliberately disabled. No retry can overwrite an existing object.
5. After TUS succeeds, the CAD Stone API rechecks the user's permission,
   verifies the provider-reported byte count exactly, and validates file
   signatures through bounded range reads. A 50 GiB PDF is inspected through
   small head/tail reads instead of being copied back through Replit.
6. Only then is the file/attachment database row inserted. Finalization is
   idempotent across retries and production instances via a Postgres advisory
   transaction lock on the unique object path.

The API emits structured `upload.direct.prepared`, `upload.direct.resigned`,
and `upload.direct.complete` events. Completion records the expected and actual
byte counts plus whether the request created a row or replayed an existing
finalization; no signature, intent token, or service-role credential is logged.

The old API-chunked route remains as a local-development fallback, but the
production web application no longer relies on Replit to proxy or assemble
large file bytes.

## Data-preservation guarantee

- Every upload uses a new unique path.
- Direct upload never sends `x-upsert`.
- Finalization never deletes a storage object, including on validation or
  database failure. A failed new upload remains unreferenced and recoverable.
- Existing customer objects and database rows are never changed by prepare or
  finalization.
- Repeated finalization returns the already-created row and does not duplicate
  it.

Explicit user-triggered delete/purge flows are unchanged and remain the only
paths that remove customer files.

## Supported ceiling and provider configuration

- App per-file ceiling: 50 GiB (`53,687,091,200` bytes).
- Supabase hosted resumable-upload ceiling: 50 GiB on the current plan.
- TUS chunk size: 6 MiB.
- Supabase signed-upload token: 2 hours (used to create the TUS upload).
- CAD Stone resumable-upload intent: 7 days.
- TUS upload URL: up to 24 hours.
- Video duration: no application-level cap; duration probing is retained only
  as display metadata.

Production release requires both Supabase's global Storage upload limit and
the private `cadstone-files` bucket limit to be 50 GiB. The API also verifies
and raises the bucket limit to the app ceiling on startup once the project-wide
limit permits it.

## Verification requirements

- Unit coverage for 50 GiB policy constants and unlimited video duration.
- Storage-provider coverage proving only an object-scoped signature leaves the
  API and `x-upsert` is absent.
- Range-read coverage proving size and signature checks do not issue a full
  object GET.
- API coverage proving completion is exact, idempotent, and leaves both valid
  and mismatched objects untouched.
- Existing Anwar upload, magic-byte, first-party delivery, financial parser,
  Sales sorting, typecheck, codegen, dead-code, bundle, full API, full web, and
  Playwright gates must remain green before publish.
