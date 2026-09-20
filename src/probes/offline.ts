import { probeParsers } from './parsers.js';

console.log(JSON.stringify({ schemaVersion: 1, platform: process.platform,
  arch: process.arch, node: process.version, parsers: await probeParsers() }, null, 2));
