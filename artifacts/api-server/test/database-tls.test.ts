import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import { databaseConnectionOptions, supabaseRootCa } from "../../../lib/db/src/connection-options.ts";
import { pgEnvFromDatabaseUrl } from "../scripts/lib/backup-tls.mjs";

test("production database connections require certificate-verified TLS without relying on URL flags", () => {
  const config = databaseConnectionOptions("postgresql://fixture:password@example.test/postgres", true);
  const client = new pg.Client(config);
  assert.ok(client.ssl && typeof client.ssl === "object");
  assert.equal(client.ssl.rejectUnauthorized, true);
  assert.ok(Array.isArray(client.ssl.ca) && client.ssl.ca.includes(supabaseRootCa));
});

test("inherited URL parameters cannot disable or override production certificate validation", () => {
  for (const parameters of ["sslmode=disable", "ssl=false", "sslmode=no-verify", "sslmode=require&uselibpqcompat=true", "sslrootcert=/missing/certificate&sslkey=/missing/key&sslcert=/missing/cert"]) {
    const config = databaseConnectionOptions(`postgresql://fixture:p%40ss@example.test/postgres?application_name=slabplan&${parameters}`, true);
    const client = new pg.Client(config);
    assert.ok(client.ssl && typeof client.ssl === "object");
    assert.equal(client.ssl.rejectUnauthorized, true);
    const url = new URL(config.connectionString!);
    assert.equal(url.password, "p%40ss");
    assert.equal(url.searchParams.get("application_name"), "slabplan");
    assert.equal(url.searchParams.has("sslmode"), false);
    assert.equal(url.searchParams.has("sslrootcert"), false);
  }
});

test("local test databases keep their explicit non-production connection settings", () => {
  const connectionString = "postgresql://fixture:password@localhost/test?sslmode=disable";
  assert.deepEqual(databaseConnectionOptions(connectionString, false), { connectionString });
});

test("backup connections require hostname-verified TLS and ignore unsafe URL flags", () => {
  const result = pgEnvFromDatabaseUrl("postgresql://fixture:p%40ss@example.test:5432/postgres?sslmode=disable", "/tmp/test-ca.crt");
  assert.deepEqual(result, { PGSSLMODE: "verify-full", PGSSLROOTCERT: "/tmp/test-ca.crt", PGHOST: "example.test", PGPORT: "5432", PGDATABASE: "postgres", PGUSER: "fixture", PGPASSWORD: "p@ss" });
  assert.throws(() => pgEnvFromDatabaseUrl("postgresql://example.test/postgres", ""), /trusted CA/);
});

test("the public Supabase CA matches the verified vendor fingerprint and remains valid", () => {
  const certificate = new X509Certificate(supabaseRootCa);
  assert.equal(certificate.ca, true);
  assert.equal(certificate.fingerprint256, "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA");
  assert.ok(Date.parse(certificate.validFrom) < Date.now());
  assert.ok(Date.parse(certificate.validTo) > Date.now() + 90 * 86400000);
});
