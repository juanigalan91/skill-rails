#!/usr/bin/env bash
# The real fetch needs the network; the tests replace it with a stub.
echo "no network in this script" >&2
exit 1
