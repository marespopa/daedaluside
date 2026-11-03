import type { Extension } from '@codemirror/state'
import { LanguageDescription } from '@codemirror/language'
import { languages } from '@codemirror/language-data'

export const languageList = languages

export function findLanguage(nameOrFile: string): LanguageDescription | null {
  return (
    LanguageDescription.matchFilename(languages, nameOrFile) ??
    languages.find((l) => l.name.toLowerCase() === nameOrFile.toLowerCase()) ??
    null
  )
}

/** Loads the parser on demand; resolves to [] for unknown languages or load failures. */
export async function loadLanguage(
  nameOrFile: string,
): Promise<{ name: string; extension: Extension } | null> {
  const desc = findLanguage(nameOrFile)
  if (!desc) return null
  try {
    const support = await desc.load()
    return { name: desc.name, extension: support }
  } catch {
    return null
  }
}
