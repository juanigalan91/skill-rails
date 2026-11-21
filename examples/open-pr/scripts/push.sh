#!/usr/bin/env bash
# Pushes the current branch. It never force-pushes.
set -eo pipefail
if git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
  git push --quiet
else
  git push --quiet -u origin HEAD
fi
