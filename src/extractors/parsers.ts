import { Parser, Language } from 'web-tree-sitter';
import { fileURLToPath } from 'node:url';

export const languages = ['javascript', 'typescript', 'tsx', 'python', 'java', 'go', 'rust'] as const;
export type CodeLanguage = typeof languages[number];
let initialized: Promise<void> | undefined;
const loaded = new Map<CodeLanguage, Promise<Language>>();

/** Resolve bundled grammars relative to this module, never the working directory. */
export async function createParser(language: CodeLanguage): Promise<Parser> {
  initialized ??= Parser.init();
  await initialized;
  let grammar = loaded.get(language);
  if (!grammar) {
    grammar = Language.load(fileURLToPath(new URL(`../../assets/tree-sitter-${language}.wasm`, import.meta.url)));
    loaded.set(language, grammar);
  }
  const parser = new Parser();
  parser.setLanguage(await grammar);
  return parser;
}
