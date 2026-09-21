// Prevent retired product modules from surviving an incremental TypeScript build.
import { rm } from 'node:fs/promises';
await rm(new URL('../dist/', import.meta.url), { recursive: true, force: true });
