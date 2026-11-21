#!/usr/bin/env bash
# The branch, its base, its open PR, the commits, the changed files and the PR template.
set -eo pipefail
branch="$(git branch --show-current)"
default="$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)"
pr="$(gh pr view --json number,url,baseRefName,state --jq 'select(.state == "OPEN") | [.number, .url, .baseRefName] | @tsv' 2>/dev/null || true)"
IFS=$'\t' read -r number url pr_base <<<"$pr"
base="${pr_base:-$default}"
git fetch --quiet origin "$base" || echo "::warning::Could not fetch origin/$base: the base may be stale."
merge_base="$(git merge-base "origin/$base" HEAD 2>/dev/null || git merge-base "$base" HEAD)"
template=""
for f in .github/PULL_REQUEST_TEMPLATE.md .github/pull_request_template.md PULL_REQUEST_TEMPLATE.md docs/PULL_REQUEST_TEMPLATE.md; do
  if [ -f "$f" ]; then template="$f"; break; fi
done
{
  printf '%s\n' "branch=$branch" "base=$base" "pr_number=$number" "pr_url=$url" "template=$template"
  echo 'commits<<EOF'; git log "$merge_base..HEAD" --oneline; echo EOF
  echo 'files<<EOF'; git diff "$merge_base..HEAD" --name-only; echo EOF
  echo 'recent<<EOF'; git log "origin/$base" --oneline -10 2>/dev/null || true; echo EOF
} >> "$FLOW_OUTPUT"
if [ -n "$(git status --short)" ]; then echo "::warning::The uncommitted changes are not part of the PR."; fi
