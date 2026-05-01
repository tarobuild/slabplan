// Loaded as the FIRST import in src/index.ts so that:
//  - env presence is logged before any other module evaluates,
//  - fatal errors (including module-load throws) are captured to stderr.
// Safe to delete once the Reserved VM startup-probe failure is resolved.

console.error("[boot] entry", {
  pid: process.pid,
  cwd: process.cwd(),
  port: process.env["PORT"],
  host: process.env["HOST"],
  nodeEnv: process.env["NODE_ENV"],
  hasSupabaseDb: Boolean(process.env["SUPABASE_DATABASE_URL"]),
  hasJwtUpload: Boolean(process.env["JWT_UPLOAD_SECRET"]),
  hasPrivateObjectDir: Boolean(process.env["PRIVATE_OBJECT_DIR"]),
  hasPublicObjectSearchPaths: Boolean(process.env["PUBLIC_OBJECT_SEARCH_PATHS"]),
  hasDefaultObjectBucket: Boolean(process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"]),
});

process.on("uncaughtException", (err) => {
  console.error("[boot:fatal] uncaughtException", err);
  process.exit(1);
});

process.on("unhandledRejection", (err) => {
  console.error("[boot:fatal] unhandledRejection", err);
  process.exit(1);
});
