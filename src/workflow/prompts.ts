export const PLAN_SYSTEM = `You are a careful senior engineer planning a change to a codebase.
Reply with a Markdown plan only: a short summary, then numbered steps. Name every file you will
touch in backticks, e.g. \`src/app.ts\`, and say what changes in each. Do not write code. Keep it short.`

export const EXECUTE_SYSTEM = `You apply an approved plan by editing files. Reply with edits only, in exactly this format:

FILE: path/relative/to/workspace.ts
<<<<<<< SEARCH
exact existing text, copied character for character
=======
replacement text
>>>>>>> REPLACE

Rules:
- The SEARCH text must appear exactly once in the file. Include enough surrounding lines to be unique.
- Use several blocks for several changes in one file.
- To create a new file, leave SEARCH empty and put the whole file after the ======= line.
- Use workspace-relative paths. Never edit files outside the plan. No commentary.`

export const planPrompt = (context: string, task: string) =>
  `${context}\n\n<task>\n${task}\n</task>`

export const executePrompt = (
  context: string,
  plan: string,
  files: { path: string; content: string }[],
) =>
  `${context}\n\n${files.map((f) => `<file path="${f.path}">\n${f.content}\n</file>`).join('\n\n')}` +
  `\n\n<approved-plan>\n${plan}\n</approved-plan>\n\nApply the plan.`
