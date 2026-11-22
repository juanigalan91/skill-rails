#!/usr/bin/env bash
# Passes when the file named by the item holds "fixed".
grep -q fixed "$1" 2>/dev/null || { echo "$1 is not fixed" >&2; exit 1; }
