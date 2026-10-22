#!/bin/sh
set -eu
DEPLOY_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$DEPLOY_ROOT"
if docker compose version >/dev/null 2>&1; then
  exec docker compose -p tongye -f compose.yml -f deploy/compose.image.yml "$@"
fi
exec docker-compose -p tongye -f compose.yml -f deploy/compose.image.yml "$@"
