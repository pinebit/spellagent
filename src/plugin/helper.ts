import { handleRequest, MAX_REQUEST_BYTES, ProtocolError, PROTOCOL_VERSION } from './protocol.js';
import { MIGRATION_GUIDANCE } from '../discovery/config.js';

// One JSON document in, one JSON document out. No public argv interface.
try {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new ProtocolError('node_24_required');
  if (process.argv.length !== 2) throw new ProtocolError('stdin_only');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_REQUEST_BYTES) throw new ProtocolError('request_too_large');
    chunks.push(bytes);
  }
  let input: unknown;
  try {
    input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } catch { throw new ProtocolError('invalid_json'); }
  process.stdout.write(JSON.stringify({ ok: true, ...await handleRequest(input) }) + '\n');
} catch (error) {
  // Never echo input, parser exceptions, stack traces, or filesystem paths.
  const code = error instanceof ProtocolError ? error.code : 'extraction_failed';
  process.stdout.write(JSON.stringify({ ok: false, protocolVersion: PROTOCOL_VERSION, code,
    ...(error instanceof ProtocolError ? error.details : {}),
    ...(code === 'preferences_migration_required' ? { guidance: MIGRATION_GUIDANCE } : {}) }) + '\n');
  process.exitCode = 2;
}
