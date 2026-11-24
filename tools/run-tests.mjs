#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scopeArg = process.argv.find((arg) => arg.startsWith('--scope='));
const scope = scopeArg ? scopeArg.slice('--scope='.length) : 'all';
const reporterArg = process.argv.find((arg) => arg.startsWith('--reporter='));
const reporter = reporterArg ? reporterArg.slice('--reporter='.length) : null;

const groups = {
  echo2: ['tests/echo2.test.mjs'],
  echo3: ['tests/echo3-openclaw.test.mjs'],
  echo4: [
    'tests/echo4-installer.test.mjs',
    'tests/echo4-installer-host1.test.mjs',
    'tests/echo4-installer-host2.test.mjs',
    'tests/echo4-installer-host3a.test.mjs',
    'tests/echo4-installer-host3b.test.mjs',
    'tests/echo4-audit-regressions.test.mjs',
  ],
};

const files = scope === 'all'
  ? [...groups.echo2, ...groups.echo3, ...groups.echo4]
  : groups[scope];
if (!files) {
  console.error(`Unknown test scope: ${scope}`);
  process.exit(2);
}

const cleanEnv = { ...process.env };
for (const key of Object.keys(cleanEnv)) {
  if (key === 'FAKE_FAIL_ON' || key.startsWith('FAKE_OPENCLAW_')) delete cleanEnv[key];
}

for (const rel of files) {
  const args = ['--test', '--test-concurrency=1'];
  if (reporter) args.push(`--test-reporter=${reporter}`);
  args.push(rel);
  console.log(`\n=== ${rel} ===`);
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env: cleanEnv,
    stdio: 'inherit',
    windowsHide: true,
    timeout: 180_000,
  });
  if (result.error || result.status !== 0) {
    console.error(`ECHO_TEST_FILE_FAIL ${rel}: ${result.error?.message ?? `exit=${result.status} signal=${result.signal ?? 'none'}`}`);
    process.exit(result.status || 1);
  }
}

console.log(`\nECHO_TEST_FILES_PASS scope=${scope} files=${files.length}/${files.length}`);
