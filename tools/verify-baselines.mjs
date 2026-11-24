import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseline = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'development', 'integrity', 'SOURCE_BASELINES.json'), 'utf8'));
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const fileSha = (rel) => sha(fs.readFileSync(path.join(root, rel)));

if (fileSha('protocol-pack/execution-overlay.v1.json') !== baseline.execution_overlay.sha256) {
  throw new Error('execution overlay baseline mismatch');
}

const runtime = JSON.parse(fs.readFileSync(path.join(root, 'runtime/protocols.json'), 'utf8'));
const protocolFiles = {
  'rcp@1.5a': ['rcp', 'protocol-pack/rcp_v1.5a.yaml'],
  'rv-lite-core@1.1.0': ['rv-lite-core', 'protocol-pack/rv_lite_core_v1.1.0.yaml'],
  'rv-lite-extended@1.1.0': ['rv-lite-extended', 'protocol-pack/rv_lite_extended_v1.1.0.yaml'],
  'telepathy@1.1': ['telepathy', 'protocol-pack/telepathy_v1.1.yaml'],
};
for (const [pin, [id, rel]] of Object.entries(protocolFiles)) {
  const got = fileSha(rel);
  if (got !== baseline.protocol_manifests[pin]) throw new Error(`protocol source baseline mismatch: ${pin}`);
  if (runtime.protocols[id].manifest_sha256 !== got) throw new Error(`runtime protocol pin mismatch: ${pin}`);
}

const targetRoot = path.join(root, 'targets', 'source');
function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}
const targetFiles = walk(targetRoot).sort((a, b) => a.localeCompare(b));
if (targetFiles.length !== baseline.target_source_tree.file_count) throw new Error('target source count mismatch');
const combined = targetFiles.map((file) => {
  const rel = path.relative(targetRoot, file).split(path.sep).join('/');
  return `${rel}\t${sha(fs.readFileSync(file))}\n`;
}).join('');
if (sha(Buffer.from(combined, 'utf8')) !== baseline.target_source_tree.combined_path_hash_sha256) {
  throw new Error('target source tree baseline mismatch');
}

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'runtime/target-catalog.json'), 'utf8'));
if (catalog.count !== targetFiles.length || catalog.targets.length !== targetFiles.length) throw new Error('target catalog count mismatch');
for (const target of catalog.targets) {
  const bytes = fs.readFileSync(path.join(targetRoot, target.source_path));
  if (sha(bytes) !== target.sha256) throw new Error(`target catalog byte mismatch: ${target.target_id}`);
}

console.log(`PASS baselines: 4 protocols, overlay, ${targetFiles.length} target files`);
