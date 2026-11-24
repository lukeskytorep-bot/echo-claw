import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256Bytes } from './canonical.mjs';
import { EchoError } from './errors.mjs';

const catalogPath = fileURLToPath(new URL('../runtime/target-catalog.json', import.meta.url));
const sourceRoot = fileURLToPath(new URL('../targets/source/', import.meta.url));

export function loadBundledTargetCatalog() {
  return JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
}

export function readBundledTarget(entry) {
  const abs = path.join(sourceRoot, entry.source_path);
  const bytes = fs.readFileSync(abs);
  const hash = sha256Bytes(bytes);
  if (hash !== entry.sha256) throw new EchoError('TARGET_SOURCE_HASH_MISMATCH', `source drift: ${entry.source_path}`);
  return { ...entry, content: bytes.toString('utf8') };
}

export function importBundledTargets(engine, ctx) {
  const catalog = loadBundledTargetCatalog();
  const results = [];
  for (const entry of catalog.targets) results.push(engine.importTarget(ctx, readBundledTarget(entry)));
  return { count: results.length, imported: results.filter((x) => x.imported).length };
}
