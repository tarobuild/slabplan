# No-Mock Production Path Review

Date: 2026-05-17

## Result

Pass, after cleanup.

## Scope

Reviewed production application paths under:

- `artifacts/api-server/src`
- `artifacts/cadstone/src`
- `lib`

Excluded generated clients, tests, and `artifacts/mockup-sandbox`.

## Findings

- Removed the unused `PageStub` component, which still rendered scaffold copy.
- Removed development seed exports from the main `@workspace/db` package entry.
  Seed data remains available only through the explicit `@workspace/db/seed`
  subpath and `pnpm --filter @workspace/db run seed` development command.
- Remaining scan hits are production UI placeholder attributes, legitimate
  invite placeholder-password wording, the system `Unknown client` migration
  sentinel for legacy rows, and development seed files outside runtime app
  paths.

## Commands

```bash
rg -n "\b(mock|mocked|fixture|faker|placeholder|demo|sample|seed|test data|lorem|example\.com|TODO|FIXME)\b" \
  artifacts/api-server/src artifacts/cadstone/src lib \
  -g '!**/*.test.ts' \
  -g '!**/test/**' \
  -g '!**/tests/**' \
  -g '!**/generated/**' \
  -g '!**/mockup-sandbox/**'
```

Production-path mocked data: none found after the cleanup above.
