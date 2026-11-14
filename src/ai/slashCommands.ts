import type { createStore } from 'jotai'
import {
  addNotice,
  chatBusyAtom,
  chatModeAtom,
  clearChat,
  sendChat,
  stopChat,
  summarizeChat,
} from './chat'

type Store = ReturnType<typeof createStore>

export interface SlashCommand {
  name: string
  description: string
  run(store: Store, args: string): void | Promise<void>
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: 'clear',
    description: 'Clear the conversation',
    run: (store) => clearChat(store),
  },
  {
    name: 'new',
    description: 'Start a new conversation',
    run: (store) => clearChat(store),
  },
  {
    name: 'stop',
    description: 'Stop the reply in progress',
    run: () => stopChat(),
  },
  {
    name: 'summarize',
    description: 'Replace the history with a short summary',
    run: (store) => summarizeChat(store),
  },
  {
    name: 'plan',
    description: 'Plan first: research and propose, change nothing',
    run: (store, args) => {
      store.set(chatModeAtom, 'plan')
      if (args.trim()) return sendChat(store, args)
      return addNotice(
        store,
        'Plan mode is on. Describe the change; no files will be touched.',
      )
    },
  },
  {
    name: 'agent',
    description: 'Do the work: read, edit and write files (the default)',
    run: (store, args) => {
      store.set(chatModeAtom, 'agent')
      if (args.trim()) return sendChat(store, args)
      return addNotice(store, 'Agent mode is on. Requests are carried out in your files.')
    },
  },
  {
    name: 'help',
    description: 'List the commands',
    run: (store) =>
      addNotice(
        store,
        SLASH_COMMANDS.map((c) => `/${c.name}: ${c.description}`).join('\n'),
      ),
  },
]

/** Commands whose name starts with what the user has typed after the slash. */
export function matchCommands(draft: string): SlashCommand[] {
  const m = /^\/(\S*)$/.exec(draft)
  if (!m) return []
  const typed = m[1]!.toLowerCase()
  return SLASH_COMMANDS.filter((c) => c.name.startsWith(typed))
}

/**
 * Handles one line from the input box: a known slash command runs, a lone unknown `/word`
 * gets a hint, and anything else (including a path like `/etc/hosts why?`) is sent as a message.
 */
export async function submitChatInput(store: Store, text: string): Promise<void> {
  const line = text.trim()
  const m = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(line)
  if (!m) return sendChat(store, text)
  const name = m[1]!.toLowerCase()
  const cmd = SLASH_COMMANDS.find((c) => c.name === name)
  if (cmd) {
    if (
      store.get(chatBusyAtom) &&
      cmd.name !== 'stop' &&
      cmd.name !== 'clear' &&
      cmd.name !== 'new'
    ) {
      addNotice(store, `Wait for the reply to finish, or use /stop first.`)
      return
    }
    return cmd.run(store, m[2] ?? '')
  }
  if (m[2] === undefined && !name.includes('/')) {
    addNotice(store, `Unknown command /${name}. Type /help to see the commands.`)
    return
  }
  return sendChat(store, text)
}
