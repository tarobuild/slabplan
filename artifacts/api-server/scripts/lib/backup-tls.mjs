export function pgEnvFromDatabaseUrl(databaseUrl, certificatePath) {
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !certificatePath) throw new Error("A PostgreSQL URL and trusted CA path are required.");
  const env = { PGSSLMODE: "verify-full", PGSSLROOTCERT: certificatePath };
  if (url.hostname) env.PGHOST = url.hostname;
  if (url.port) env.PGPORT = url.port;
  if (url.pathname && url.pathname !== "/") env.PGDATABASE = decodeURIComponent(url.pathname.slice(1));
  if (url.username) env.PGUSER = decodeURIComponent(url.username);
  if (url.password) env.PGPASSWORD = decodeURIComponent(url.password);
  return env;
}
