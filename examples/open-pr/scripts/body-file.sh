#!/usr/bin/env bash
# Starts the PR body from the template, or from a short default.
set -eo pipefail
file="$(mktemp "${TMPDIR:-/tmp}/skillflow-pr-body.XXXXXX")"
if [ -n "$TEMPLATE" ]; then
  cp "$TEMPLATE" "$file"
else
  printf '## Summary\n\n[1 sentence on the goal, then 2-4 bullet points]\n\n## Testing\n\n[How to test, or "No manual testing required"]\n' > "$file"
fi
echo "file=$file" >> "$FLOW_OUTPUT"
