#!/usr/bin/env bash
set -euo pipefail

grep_args=()
if [[ -n "${TEST_GREP:-}" ]]; then
  grep_args+=(--grep "$TEST_GREP")
fi

if (( ${#grep_args[@]} )); then
  npx ts-mocha -p ./tsconfig.tests.json -t 1000000 "tests/**/*.ts" --exclude "tests/ui/**" "${grep_args[@]}" "$@"
else
  npx ts-mocha -p ./tsconfig.tests.json -t 1000000 "tests/**/*.ts" --exclude "tests/ui/**" "$@"
fi
