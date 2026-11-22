#!/usr/bin/env bash
# Prints the branch and its base, as KEY=value lines.
set -eu
base=main
while [[ $# -gt 0 ]]; do
  case "$1" in
    --base) base="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
echo "BRANCH=${DEMO_BRANCH:-feature}"
echo "BASE=$base"
echo "DIR=$(pwd)"
