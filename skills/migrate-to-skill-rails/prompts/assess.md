Skill: ${{ steps.context.outputs.source }}
Additional request: ${{ inputs.request }}
Files outside the skill that name its Markdown files: ${{ toJSON(steps.readers.outputs.readers) }}

Read the SKILL.md, the files it loads, and each file in the list above.
Decide whether a flow makes this skill better, before any migration work.

Keep the skill as Markdown when one of these is true:

- Code, a CI job or another tool reads the text of the skill (for example to put it in a prompt), so a SKILL.md that only starts a flow breaks it.
- The skill runs where the runner cannot run: no shell, no Node.js or npx, or the shell is denied.
- The skill (or one of its modes) runs unattended on untrusted input, such as a CI review of a pull request. A flow needs permission to run `skill-rails start`, and a prompt injection could then start any flow file and run any command. Keep that mode as Markdown.
- The skill is reference text that the agent preloads or reads (rules, a checklist, a style guide), with no steps to run.
- The skill only sends the user to another skill, or another skill replaces it.
- The skill only runs one script. Tell the caller to run the script directly: a flow costs a runner start and gives nothing. A flow file is still useful when other flows run it with `uses`; then keep the SKILL.md on the script.
- The skill is a long guide where the flow would only be one prompt per section of the guide, with no script, no gate and no loop. The flow then copies the guide into prompts, and its tests check only the order of the prompts.
- The skill is so short that a flow adds more than it removes.

Also report a risk, and do not block on it, when the skill runs in CI or in another unattended service: the flow then needs the skill-rails package and network access at run time.

Migrate the skill when it has deterministic work that code does better (git, gh, file checks, parsing, rendering a fixed format, validation), ordered steps with gates, user questions, loops, or calls to other skills.

Give `partial` when only some modes or files can move: name the files that stay Markdown in `keep` (for example an unattended mode file that CI reads).
Give the evidence for each reason: a file, a line, or a caller.
Do not write files in this step.
