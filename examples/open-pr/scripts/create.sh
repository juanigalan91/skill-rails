#!/usr/bin/env bash
# Creates the PR with the body that the agent wrote.
set -eo pipefail
args=(--title "$TITLE" --base "$BASE" --body-file "$BODY")
if [ "$DRAFT" = true ]; then args+=(--draft); fi
echo "url=$(gh pr create "${args[@]}" | tail -n 1)" >> "$FLOW_OUTPUT"
