import path from 'node:path';
import type { FileSnapshot } from '../core/contracts.js';

export const GENERATED_DETECTION_VERSION = '1' as const;
export const EXTRACTOR_VERSION = '1' as const;

export type SupportedFormat = FileSnapshot['format'];
export const EXTENSION_FORMAT: Readonly<Record<string, SupportedFormat>> = {
  '.md': 'markdown', '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.ts': 'typescript', '.mts': 'typescript', '.cts': 'typescript', '.tsx': 'tsx',
  '.py': 'python', '.pyi': 'python', '.java': 'java', '.go': 'go', '.rs': 'rust',
};

export const MANDATORY_DIRECTORY_NAMES = new Set([
  '.git', '.hg', '.svn', '.spellagent', 'node_modules', 'vendor', 'dist', 'build', 'target',
  '.venv', 'venv', '__pycache__', '.ssh', '.aws', '.azure', '.gnupg', '.kube',
]);
export const MANDATORY_FILE_NAMES = new Set([
  '.gitignore', '.gitattributes', '.gitmodules', 'package-lock.json', 'npm-shrinkwrap.json',
  'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb', 'Cargo.lock', 'go.sum', 'Pipfile.lock',
  'poetry.lock', 'uv.lock', 'composer.lock', '.spellagentrc.json',
]);

const generatedPathRules: readonly { id: string; regex: RegExp }[] = [
  { id: 'protobuf_go', regex: /(?:^|\/)[^/]+(?:_grpc)?\.pb\.go$/u },
  { id: 'protobuf_python', regex: /(?:^|\/)[^/]+_pb2(?:_grpc)?\.pyi?$/u },
  { id: 'protobuf_javascript', regex: /(?:^|\/)[^/]+_(?:grpc_)?pb\.(?:d\.ts|js|ts)$/u },
  { id: 'generated_suffix', regex: /(?:^|\/)[^/]+\.generated\.[^/]+$/u },
  { id: 'go_gen_suffix', regex: /(?:^|\/)[^/]+\.gen\.go$/u },
  { id: 'minified', regex: /(?:^|\/)[^/]+\.min\.(?:js|mjs|cjs)$/u },
];

export function generatedPathRule(relativePath: string): string | undefined {
  return generatedPathRules.find(rule => rule.regex.test(relativePath))?.id;
}

export function mandatoryPathReason(relativePath: string, includeHidden: boolean): string | undefined {
  const parts = relativePath.split('/');
  const file = parts.at(-1)!;
  if (parts.some(part => MANDATORY_DIRECTORY_NAMES.has(part))) return 'mandatory_directory';
  if (MANDATORY_FILE_NAMES.has(file) || file.endsWith('.lock')) return 'mandatory_file';
  if (/^\.env|^(?:credentials|secrets?)(?:[.-]|$)|^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.|$)|\.(?:pem|key|p12|pfx)$/iu.test(file)) return 'credential_file';
  if (!includeHidden && parts.some(part => part.startsWith('.'))) return 'hidden_path';
  return generatedPathRule(relativePath) ? 'generated_path' : undefined;
}

export function formatForPath(relativePath: string): SupportedFormat | undefined {
  return EXTENSION_FORMAT[path.posix.extname(relativePath).toLowerCase()];
}
