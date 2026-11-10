/** An agent defined by a Markdown file with front matter, as in `.claude/agents/*.md`. */
export interface AgentDef {
  name: string
  description: string
  /** `haiku`, `sonnet`, `opus`, `provider/model`, or absent to use the chat's own model. */
  model?: string
  /** Tool names as written in the file (`Read, Grep`); mapped to workspace tools at run time. */
  tools?: string[]
  /** The agent's instructions: the file body. */
  prompt: string
  path: string
}

const FRONT = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/

function unquote(v: string): string {
  const t = v.trim()
  return /^(["']).*\1$/.test(t) ? t.slice(1, -1) : t
}

/** Parses one agent file. Returns null when it has no front matter or no instructions. */
export function parseAgent(path: string, text: string): AgentDef | null {
  const m = FRONT.exec(text)
  if (!m) return null
  const fields = new Map<string, string>()
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line)
    if (kv) fields.set(kv[1]!.toLowerCase(), unquote(kv[2]!))
  }
  const prompt = m[2]!.trim()
  const name = fields.get('name') || /([^/]+)\.md$/i.exec(path)?.[1]
  if (!name || !prompt) return null
  const model = fields.get('model')
  const tools = fields
    .get('tools')
    ?.split(',')
    .map((t) => t.trim())
    .filter(Boolean)
  return {
    name,
    description: fields.get('description') ?? '',
    ...(model && model !== 'inherit' ? { model } : {}),
    ...(tools?.length ? { tools } : {}),
    prompt,
    path,
  }
}
