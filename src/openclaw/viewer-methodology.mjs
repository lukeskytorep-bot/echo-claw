import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { EchoError } from '../errors.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const REF = path.join(ROOT, 'docs', 'reference', 'project-content', 'protocols');

const FILES = Object.freeze({
  rcp: { en: ['resonant_contact_protocol_v1.5a.md','f094e44a5fac7971d4de66f569602c27f80c89d93d6afacd9334a8054817c1f0'] },
  telepathy: { en: ['telepathy_module_v1.1.md','e02817dbe80f4bbcd907d6a26d14c6d5e6a9a301e023cc5f90fbc4831f5644d5'] },
  'rv-lite-core': { pl: ['rv_lite_core_v1.1.0_pl.md','80a417f17029d3fe4f10a0b3af3d5fe65658ff3ce43ae23bda0d8864551377bd'], en: ['rv_lite_core_v1.1.0_en.md','740cebe1d2c18ef14fb66203289edf4e39dcd5cf5a5a08dbb6c9324632e8a5a2'] },
  'rv-lite-extended': { pl: ['rv_lite_extended_harness_v1_pl.md','7118fa26eca259e8da3320ca7e6298e2699bb280d9b0363711ba30dec337c1f1'], en: ['rv_lite_extended_harness_v1_en.md','d178a1b59ba8aba3e5c6cf70bfa1886c0629bb3143ed8b4ac67399c491489fbb'] },
});

function read(protocolId, language) {
  const entry = FILES[protocolId];
  if (!entry) throw new EchoError('METHODOLOGY_SOURCE_MISSING', `no canonical methodology source for ${protocolId}`);
  const selected = entry[language] ?? entry.en ?? entry.pl;
  const [filename, expectedSha256] = selected;
  const full = path.join(REF, filename);
  if (!fs.existsSync(full)) throw new EchoError('METHODOLOGY_SOURCE_MISSING', `canonical methodology file missing: ${filename}`);
  const bytes = fs.readFileSync(full);
  const actualSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  if (actualSha256 !== expectedSha256) throw new EchoError('METHODOLOGY_SOURCE_HASH_MISMATCH', `canonical methodology hash mismatch: ${filename}`);
  return bytes.toString('utf8').replace(/\r\n?/gu, '\n');
}

function slice(text, startRe, endRe = null) {
  const start = text.search(startRe);
  if (start < 0) throw new EchoError('METHODOLOGY_ANCHOR_MISSING', `canonical methodology start anchor not found: ${startRe}`);
  const tail = text.slice(start);
  if (!endRe) return tail.trim();
  const rel = tail.slice(1).search(endRe);
  if (rel < 0) return tail.trim();
  return tail.slice(0, rel + 1).trim();
}

function rvPrompt(text, n) {
  const start = new RegExp(`^## PROMPT ${n}\\b`, 'mu');
  const end = n < 4 ? new RegExp(`^## PROMPT ${n + 1}\\b`, 'mu') : /^## (?:Granica Reveal|Reveal boundary)\b/mu;
  return slice(text, start, end);
}

function rvOverlay(section, { taskingMode, neutralCode, language, promptNumber }) {
  if (promptNumber === 1 && taskingMode === 'no_code') {
    if (language === 'pl') {
      section = section.replace(/Nie rozpoczynaj sesji, dopóki nie otrzymasz kodu sesji\./u, 'Nie rozpoczynaj sesji, dopóki nie otrzymasz polecenia rozpoczęcia.');
    } else {
      section = section.replace(/Do not begin the session until you receive the session code\./u, 'Do not begin the session until you receive the instruction to begin.');
    }
  }
  if (promptNumber === 2) {
    if (taskingMode === 'no_code') {
      return language === 'pl'
        ? '## PROMPT 2 — Start bez kodu\n\nWitaj. Cel został wybrany. Rozpocznij sesję.\n\nCelu nie nazywamy — tylko go opisujemy.\n\nWykonaj Krok 1 i Krok 2.'
        : '## PROMPT 2 — Start without code\n\nHello. The target has been selected. Begin the session.\n\nDo not name the target — only describe it.\n\nPerform Step 1 and Step 2.';
    }
    const code = String(neutralCode ?? '').trim();
    if (!code) throw new EchoError('NEUTRAL_CODE_REQUIRED', 'neutral_code tasking requires a neutral code');
    section = section.replace(/\{\{SESSION_CODE\}\}/gu, code);
  }
  return section;
}

function rcpSection(text, stepId) {
  if (stepId === 'rcp.prepare') return slice(text, /^## 👤IDENTITY AND PREMISES/mu, /^# The Protocol/mu);
  const ranges = {
    'rcp.phase1': [/^## Phase 1 – AI Touch \(6×\)/mu, /^## 🔹 PHASE 2/mu],
    'rcp.phase2': [/^## 🔹 PHASE 2/mu, /^## 🔹 PHASE 3/mu],
    'rcp.phase3': [/^## 🔹 PHASE 3/mu, /^## 🔹 PHASE 4/mu],
    'rcp.phase4': [/^## 🔹 PHASE 4/mu, /^## 🔹 PHASE 5/mu],
    'rcp.phase5': [/^## 🔹 PHASE 5/mu, /^## 🔹 Phase 6/mu],
    'rcp.phase6': [/^## 🔹 Phase 6/mu, null],
  };
  const pair = ranges[stepId];
  if (!pair) throw new EchoError('METHODOLOGY_STEP_MISSING', `no RCP canonical section for ${stepId}`);
  return slice(text, pair[0], pair[1]);
}

function telepathySection(text, stepId) {
  const ranges = {
    'telepathy.t0': [/^\*\*T0 – Telepathic Reset\*\*/mu, /^### \*\*T1 – AI Touch/mu],
    'telepathy.t1': [/^### \*\*T1 – AI Touch/mu, /^\*\*T2 - Element 1/mu],
    'telepathy.t2': [/^\*\*T2 - Element 1/mu, /^\*\*T3 – Subject/mu],
    'telepathy.t3': [/^\*\*T3 – Subject/mu, /^\*\*T4 – Deep Mind/mu],
    'telepathy.t4': [/^\*\*T4 – Deep Mind/mu, /^\*\*T5 – Body Condition/mu],
    'telepathy.t5': [/^\*\*T5 – Body Condition/mu, /^\*\*T6 – Relationships/mu],
    'telepathy.t6': [/^\*\*T6 – Relationships/mu, /^\*\*T7 – Numerical Profile/mu],
    'telepathy.t7': [/^\*\*T7 – Numerical Profile/mu, /^\*\*T8 – Viewer Awareness/mu],
    'telepathy.t8': [/^\*\*T8 – Viewer Awareness/mu, /^\*\*T9 – Answers/mu],
    'telepathy.t9': [/^\*\*T9 – Answers/mu, /^\*\*T10 – Telepathic Summary/mu],
    'telepathy.t10': [/^\*\*T10 – Telepathic Summary/mu, null],
  };
  const pair = ranges[stepId];
  if (!pair) throw new EchoError('METHODOLOGY_STEP_MISSING', `no Telepathy canonical section for ${stepId}`);
  let section = slice(text, pair[0], pair[1]);
  if (stepId === 'telepathy.t0') {
    const rules = slice(text, /^### \*\*2\. General Rules\*\*/mu, /^### \*\*3\. Phases/mu);
    section = `${rules}\n\n${section}`;
  }
  return section;
}

export function canonicalMethodologyForStep({ session, tasking }) {
  const language = session.language === 'pl' ? 'pl' : 'en';
  const text = read(session.protocol_id, language);
  if (session.protocol_id === 'rcp') return rcpSection(text, session.current_step_id);
  if (session.protocol_id === 'telepathy') return telepathySection(text, session.current_step_id);
  if (session.protocol_id === 'rv-lite-core' || session.protocol_id === 'rv-lite-extended') {
    const map = {
      [`${session.protocol_id}.prepare`]: 1,
      [`${session.protocol_id}.steps1-2`]: 2,
      [`${session.protocol_id}.step3`]: 3,
      [`${session.protocol_id}.step4`]: 4,
    };
    const promptNumber = map[session.current_step_id];
    if (!promptNumber) throw new EchoError('METHODOLOGY_STEP_MISSING', `no RV Lite canonical prompt for ${session.current_step_id}`);
    return rvOverlay(rvPrompt(text, promptNumber), { taskingMode: tasking.tasking_mode, neutralCode: tasking.neutral_code, language, promptNumber });
  }
  throw new EchoError('METHODOLOGY_SOURCE_MISSING', `no canonical methodology for ${session.protocol_id}`);
}
