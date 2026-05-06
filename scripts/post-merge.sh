#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db check-migrations-journal
pnpm --filter db migrate
