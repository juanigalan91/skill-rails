Write the pull request title and body.

1. Read `${{ steps.body-file.outputs.file }}` and fill it in place with the Edit tool.
   ${{ steps.context.outputs.template && 'It is the PR template: keep every line that you do not fill, and every HTML comment.' || '' }}
   - Start with one sentence on the goal of the PR, then 2–4 short bullet points on what it does and why.
   - Do not describe how: no function names and no file-by-file lists.
   - Fill the testing section with 1–3 manual steps, or "No manual testing required".
2. Write the title: under 72 characters, in the imperative mood, in the format of the recent commits of the base branch.

Commits of the branch:

```text
${{ steps.context.outputs.commits }}
```

Changed files:

```text
${{ steps.context.outputs.files }}
```

Recent commits of the base branch:

```text
${{ steps.context.outputs.recent }}
```
