#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export COPYFILE_DISABLE=1

mkdir -p .anchor
if [ -e .anchor/test-ledger ] && [ ! -L .anchor/test-ledger ]; then
  backup_dir="/tmp/anchor-ledger-backup-$(date +%s)"
  mv .anchor/test-ledger "$backup_dir"
fi

mkdir -p /tmp/anchor-test-ledger
ln -sfn /tmp/anchor-test-ledger .anchor/test-ledger
find /tmp/anchor-test-ledger -name '._*' -delete || true

npm test
