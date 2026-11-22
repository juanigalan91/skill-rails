#!/usr/bin/env bash
# Exit 3 with --files when STUB_FILES=refuse; exit 1 when STUB=down.
echo "fetch.sh $*" >> calls.log
[[ "${STUB:-}" == down ]] && { echo "service down" >&2; exit 1; }
[[ "${STUB_FILES:-}" == refuse && " $* " == *" --files "* ]] && { echo "no token for files" >&2; exit 3; }
echo "fetched $*"
