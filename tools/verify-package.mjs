import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'docs', 'development', 'integrity', 'PACKAGE_MANIFEST_SHA256.txt');
if (!fs.existsSync(manifestPath)) throw new Error('docs/development/integrity/PACKAGE_MANIFEST_SHA256.txt not found');

const IGNORED_DIRS = new Set(['.git', 'node_modules', '.echo-claw', 'coverage']);

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}
function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

const expected = new Map();
for (const line of fs.readFileSync(manifestPath, 'utf8').split(/\r?\n/u)) {
  if (!line.trim()) continue;
  const m = line.match(/^([a-f0-9]{64})  (.+)$/u);
  if (!m) throw new Error(`invalid manifest line: ${line}`);
  expected.set(m[2], m[1]);
}

const actualFiles = walk(root)
  .filter((file) => path.basename(file) !== 'PACKAGE_MANIFEST_SHA256.txt')
  .map((file) => path.relative(root, file).split(path.sep).join('/'))
  .sort();
const expectedFiles = [...expected.keys()].sort();
if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
  const missing = expectedFiles.filter((x) => !actualFiles.includes(x));
  const extra = actualFiles.filter((x) => !expectedFiles.includes(x));
  throw new Error(`file-set mismatch; missing=${JSON.stringify(missing)} extra=${JSON.stringify(extra)}`);
}
for (const rel of actualFiles) {
  const got = sha256(path.join(root, rel));
  if (got !== expected.get(rel)) throw new Error(`hash mismatch: ${rel}`);
}
console.log(`PASS ${actualFiles.length}/${actualFiles.length} files match PACKAGE_MANIFEST_SHA256.txt`);
