import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256Bytes } from './canonical.mjs';
import { EchoError } from './errors.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OVERLAY_PATH = path.join(HERE, '..', 'protocol-pack', 'execution-overlay.v1.json');
const OVERLAY_BYTES = fs.readFileSync(OVERLAY_PATH);
const OVERLAY = JSON.parse(OVERLAY_BYTES.toString('utf8'));

export const EXECUTION_OVERLAY = Object.freeze({
  id: OVERLAY.overlay_id,
  sha256: sha256Bytes(OVERLAY_BYTES),
  schema_version: OVERLAY.schema_version,
});

export function normalizeLanguage(language) {
  if (!['pl', 'en'].includes(language)) throw new EchoError('INVALID_LANGUAGE', 'session language must be pl or en');
  return language;
}
