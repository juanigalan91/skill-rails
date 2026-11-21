Fix all validation and deterministic test failures in `${{ steps.scaffold.outputs.target }}`:
${{ steps.check.outputs.errors }}

Follow the authoring rules from the previous step. Keep the agreed design, the original skill (if migrating), and all its rules intact. Stub every external side effect in tests; do not publish anything while repairing or testing. The runner will check again; if you cannot repair the skill, report failure with the reason.
