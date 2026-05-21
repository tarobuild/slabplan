import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const rootPackage = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
) as { scripts: Record<string, string> };
const cadstonePackage = JSON.parse(
  readFileSync(path.join(root, "artifacts/cadstone/package.json"), "utf8"),
) as { scripts: Record<string, string> };
const apiServerPackage = JSON.parse(
  readFileSync(path.join(root, "artifacts/api-server/package.json"), "utf8"),
) as { scripts: Record<string, string> };
const apiServerTsconfig = JSON.parse(
  readFileSync(path.join(root, "artifacts/api-server/tsconfig.json"), "utf8"),
) as { references: Array<{ path: string }> };
const cadstoneTestTsconfig = JSON.parse(
  readFileSync(path.join(root, "artifacts/cadstone/tsconfig.test.json"), "utf8"),
) as { include: string[]; exclude: string[] };

test("root build uses explicit release build targets", () => {
  const build = rootPackage.scripts.build;

  assert.match(build, /pnpm run build:web/);
  assert.match(build, /pnpm run build:api/);
  assert.equal(build.includes("pnpm -r"), false);
  assert.equal(build.includes("mockup-sandbox"), false);
  assert.equal(rootPackage.scripts["build:web"], "pnpm --filter @workspace/cadstone run build");
  assert.equal(
    rootPackage.scripts["build:api"],
    "pnpm --filter @workspace/api-server run build:server",
  );
});

test("release build has a single frontend build owner", () => {
  assert.equal(cadstonePackage.scripts.build, "node ../../lib/api-spec/scripts/with-codegen-lock.mjs -- vite build --config vite.config.ts");
  assert.equal(apiServerPackage.scripts["build:server"], "node ../../lib/api-spec/scripts/with-codegen-lock.mjs -- node ./build.mjs");
  assert.equal(apiServerPackage.scripts.build, apiServerPackage.scripts["build:server"]);
  assert.equal(apiServerPackage.scripts.build.includes("@workspace/cadstone"), false);
  assert.equal(apiServerPackage.scripts.build.includes("build:web"), false);
  assert.equal(rootPackage.scripts.build.match(/build:web/g)?.length, 1);
});

test("auth E2E spec has a direct package script", () => {
  assert.equal(cadstonePackage.scripts.test, 'tsx --test "src/**/*.test.ts" "src/**/*.test.tsx"');
  assert.equal(cadstonePackage.scripts["test:e2e"], "playwright test");
  assert.equal(
    cadstonePackage.scripts["test:e2e:auth"],
    "playwright test tests/e2e/auth.spec.ts",
  );
});

test("frontend test sources are typechecked by package checks", () => {
  assert.deepEqual(cadstoneTestTsconfig.include, [
    "src/**/*.test.ts",
    "src/**/*.test.tsx",
    "src/test-types.d.ts",
  ]);
  assert.equal(cadstoneTestTsconfig.exclude.includes("**/*.test.ts"), false);
  assert.match(cadstonePackage.scripts.typecheck, /tsc -p tsconfig\.test\.json --noEmit/);
  assert.equal(
    cadstonePackage.scripts["typecheck:test"],
    "node ../../lib/api-spec/scripts/with-codegen-lock.mjs -- tsc -p tsconfig.test.json --noEmit",
  );
});

test("root install does not mutate installed dependencies", () => {
  assert.equal(rootPackage.scripts.postinstall, undefined);
  assert.equal(
    Object.values(rootPackage.scripts).some((script) =>
      script.includes("patch-drizzle-errors"),
    ),
    false,
  );
});

test("api-server typecheck builds every referenced workspace library", () => {
  const typecheck = apiServerPackage.scripts.typecheck;

  for (const ref of apiServerTsconfig.references) {
    assert.match(typecheck, new RegExp(ref.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.match(typecheck, /tsc --build/);
  assert.match(typecheck, /tsc -p tsconfig\.json --noEmit/);
});
