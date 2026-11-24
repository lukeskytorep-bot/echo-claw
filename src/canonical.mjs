import { createHash, randomBytes, randomUUID } from 'node:crypto';

export function sha256Bytes(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function sha256Text(value) {
  return sha256Bytes(Buffer.from(String(value), 'utf8'));
}

function normalize(value) {
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) throw new TypeError('ECJ-1 forbids floating-point values');
    return value;
  }
  if (typeof value === 'string') return value.normalize('NFC');
  if (typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) {
      const normalizedKey = key.normalize('NFC');
      if (Object.hasOwn(out, normalizedKey)) throw new Error('duplicate key after NFC normalization');
      out[normalizedKey] = normalize(value[key]);
    }
    return Object.fromEntries(Object.keys(out).sort().map((key) => [key, out[key]]));
  }
  throw new TypeError(`ECJ-1 unsupported type: ${typeof value}`);
}

export function ecjStringify(value) {
  return JSON.stringify(normalize(value));
}

export function ecjSha256(value) {
  return sha256Text(ecjStringify(value));
}

export function uuid() {
  return randomUUID();
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function neutralCode() {
  const bytes = randomBytes(8);
  let s = '';
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}`;
}

export function nowIso(clock = () => new Date()) {
  return clock().toISOString();
}
