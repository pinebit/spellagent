// Development packaging only. No installs, network, or host configuration.
import { cp, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
const output = path.join(root, 'build/plugins');
const runtimeRoots = ['remark-parse', 'remark-gfm', 'unified', 'web-tree-sitter', 'zod'];

function resolveDependency(parent, name) {
  let base = parent;
  for (;;) {
    const candidate = path.posix.join(base, 'node_modules', name);
    if (lock.packages[candidate]) return candidate;
    if (!base) throw new Error(`Missing locked runtime dependency: ${name}`);
    base = path.posix.dirname(base);
    if (base === '.') base = '';
  }
}
const selected = new Set();
function select(location) {
  if (selected.has(location)) return;
  const entry = lock.packages[location];
  if (!entry || entry.link || !entry.version) throw new Error(`Unsupported dependency: ${location}`);
  selected.add(location);
  for (const name of Object.keys(entry.dependencies ?? {})) select(resolveDependency(location, name));
  for (const name of Object.keys(entry.peerDependencies ?? {})) {
    if (!entry.peerDependenciesMeta?.[name]?.optional) select(resolveDependency(location, name));
  }
  if (Object.keys(entry.optionalDependencies ?? {}).length) {
    throw new Error(`Review optional runtime dependencies: ${location}`);
  }
}
for (const name of runtimeRoots) select(resolveDependency('', name));
await mkdir(path.dirname(output), { recursive: true });
const staging = await mkdtemp(path.join(root, 'build/plugins-staging-'));
try {
  const workflow = await readFile(path.join(root, 'plugins/shared/workflow.md'), 'utf8');
  for (const host of ['codex', 'claude']) {
    const destination = path.join(staging, host, 'spellagent');
    await cp(path.join(root, 'plugins', host, 'spellagent'), destination, { recursive: true });
    const manifests = host === 'codex'
      ? ['plugin.json', '.codex-plugin/plugin.json'] : ['.claude-plugin/plugin.json'];
    for (const relative of manifests) {
      const manifestPath = path.join(destination, relative);
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      manifest.version = pkg.version;
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    }
    const skill = path.join(destination, 'skills/check');
    await mkdir(skill, { recursive: true });
    await cp(path.join(root, 'plugins', host, 'check.md'), path.join(skill, 'SKILL.md'));
    await writeFile(path.join(skill, 'workflow.md'), workflow);
    await cp(path.join(root, 'plugins/shared/feasibility.md'), path.join(skill, 'feasibility.md'));
    await cp(path.join(root, 'LICENSE'), path.join(destination, 'LICENSE'));
    const runtime = path.join(destination, 'runtime');
    await mkdir(path.join(runtime, 'dist'), { recursive: true });
    await writeFile(path.join(runtime, 'package.json'), JSON.stringify({
      name: 'spellagent-plugin-runtime', version: pkg.version, private: true, type: 'module',
      engines: { node: '>=24' },
    }, null, 2) + '\n');
    // Explicit allowlist excludes developer probes and any stale build output.
    for (const directory of ['core', 'discovery', 'extractors', 'plugin']) {
      await cp(path.join(root, 'dist', directory), path.join(runtime, 'dist', directory), {
        recursive: true, filter: source => !source.endsWith('.d.ts'),
      });
    }
    await cp(path.join(root, 'assets'), path.join(runtime, 'assets'), { recursive: true });
    const inventory = [];
    for (const location of [...selected].sort()) {
      const source = path.join(root, location);
      const installed = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8'));
      if (installed.version !== lock.packages[location].version) {
        throw new Error(`Installed dependency differs from lock: ${location}`);
      }
      await cp(source, path.join(runtime, location), { recursive: true,
        filter: async file => {
          if (file !== source && path.basename(file) === 'node_modules') return false;
          if ((await lstat(file)).isSymbolicLink()) throw new Error(`Symlink in runtime dependency: ${location}`);
          return true;
        },
      });
      inventory.push({ path: location, name: installed.name, version: installed.version,
        license: installed.license ?? lock.packages[location].license ?? 'Review required',
        integrity: lock.packages[location].integrity });
    }
    await writeFile(path.join(runtime, 'dependencies.json'), JSON.stringify(inventory, null, 2) + '\n');
  }
  await writeFile(path.join(staging, '.spellagent-build.json'), JSON.stringify({ version: pkg.version }) + '\n');
  let existing;
  try { existing = await lstat(output); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing) {
    if (!existing.isDirectory() || existing.isSymbolicLink()) throw new Error('Refusing unsafe plugin output path');
    await readFile(path.join(output, '.spellagent-build.json'));
    await rm(output, { recursive: true });
  }
  await rename(staging, output);
  console.log('Built read-only Codex and Claude plugin candidates in build/plugins.');
} catch (error) {
  await rm(staging, { recursive: true, force: true });
  throw error;
}
