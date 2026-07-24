#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  echo "usage: scripts/smoke-deployment.sh <base-url> [expected-release-sha]" >&2
  exit 2
fi

base_url="${1%/}"
expected_release_sha="${2:-}"
expected_release_sha="${expected_release_sha:0:12}"
tmpdir="$(mktemp -d)"
trap 'rm -rf "${tmpdir}"' EXIT

echo "Smoking ${base_url}"

home_body="${tmpdir}/home.html"
home_code="$(curl --silent --show-error --location --output "${home_body}" --write-out "%{http_code}" "${base_url}/")"
if [ "${home_code}" != "200" ]; then
  echo "::error::GET / returned HTTP ${home_code}"
  exit 1
fi
if ! grep -qi "<title>SlabPlan" "${home_body}"; then
  echo "::error::GET / did not return the SlabPlan app shell"
  exit 1
fi

livez_body="${tmpdir}/livez.json"
livez_code="$(curl --silent --show-error --output "${livez_body}" --write-out "%{http_code}" "${base_url}/api/livez")"
if [ "${livez_code}" != "200" ]; then
  echo "::error::GET /api/livez returned HTTP ${livez_code}"
  cat "${livez_body}" >&2 || true
  exit 1
fi
node -e "
const fs = require('fs');
const body = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
if (body.status !== 'ok') {
  console.error('::error::/api/livez did not report status ok');
  process.exit(1);
}
" "${livez_body}"

healthz_body="${tmpdir}/healthz.json"
healthz_code="$(curl --silent --show-error --output "${healthz_body}" --write-out "%{http_code}" "${base_url}/api/healthz")"
if [ "${healthz_code}" != "200" ]; then
  echo "::error::GET /api/healthz returned HTTP ${healthz_code}"
  cat "${healthz_body}" >&2 || true
  exit 1
fi
node -e "
const fs = require('fs');
const body = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
const errors = [];
if (body.status !== 'ok') errors.push('status');
if (body.db !== true) errors.push('db');
if (body.storage !== true) errors.push('storage');
if (!Number.isFinite(body.durationMs)) errors.push('durationMs');
if (!Array.isArray(body.errors)) errors.push('errors');
if (errors.length) {
  console.error('::error::/api/healthz failed readiness fields: ' + errors.join(', '));
  console.error(JSON.stringify(body));
  process.exit(1);
}
const expectedReleaseSha = process.argv[2] || '';
if (expectedReleaseSha) {
  if (body.releaseSha !== expectedReleaseSha) {
    console.error(
      '::error::/api/healthz releaseSha mismatch: expected ' +
        expectedReleaseSha +
        ', got ' +
        (body.releaseSha ?? '<missing>')
    );
    process.exit(1);
  }
}
" "${healthz_body}" "${expected_release_sha}"

echo "Smoke passed for ${base_url}"
