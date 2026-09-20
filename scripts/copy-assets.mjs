import { copyFile, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const assets = path.join(root, 'assets');
await rm(assets, { recursive: true, force: true });
await mkdir(path.join(assets, 'licenses'), { recursive: true });
const inventory = [];
const grammars = ['javascript', 'typescript', 'tsx', 'python', 'java', 'go', 'rust'];
for (const language of grammars) {
  const name = `tree-sitter-${language === 'tsx' ? 'typescript' : language}`;
  const dir = path.join(root, 'node_modules', name);
  const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
  if (pkg.license !== 'MIT') throw new Error(`Review changed license for ${name}`);
  const file = `tree-sitter-${language}.wasm`;
  await copyFile(path.join(dir, file), path.join(assets, file));
  await copyFile(path.join(dir, 'LICENSE'), path.join(assets, 'licenses', `${name}.txt`));
  const bytes = await readFile(path.join(assets, file));
  inventory.push({ language, package: name, version: pkg.version, license: pkg.license,
    file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
await writeFile(path.join(assets, 'inventory.json'), JSON.stringify(inventory, null, 2) + '\n');
console.log(`Bundled ${inventory.length} official WASM grammars and licenses.`);
