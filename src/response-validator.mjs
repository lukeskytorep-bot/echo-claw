const MARKER_CANDIDATE = /\[\[(ECHO):([^\]\r\n]*)\]\]/giu;
const MARKER_NAME = /^[A-Z0-9_.:-]+$/u;
const PAYLOAD_STRIP = /[`*_#>\s\-–—:;,.]+/gu;

export function parseEchoBlocks(text) {
  const matches = [...String(text).matchAll(MARKER_CANDIDATE)];
  if (!matches.length) return { blocks: [], prefix: String(text) };
  const prefix = String(text).slice(0, matches[0].index);
  const blocks = [];
  for (let i = 0; i < matches.length; i += 1) {
    const m = matches[i];
    const start = m.index + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : String(text).length;
    const rawName = m[2];
    const exact = m[1] === 'ECHO' && MARKER_NAME.test(rawName);
    blocks.push({ marker: exact ? rawName : `__INVALID_ECHO_MARKER__:${m[0]}`, payload: String(text).slice(start, end).trim() });
  }
  return { blocks, prefix };
}

function payloadPresent(payload) {
  return Boolean(String(payload).replace(PAYLOAD_STRIP, ''));
}

function exactSequence(text, expected, payloadRequired = new Set(expected)) {
  const { blocks, prefix } = parseEchoBlocks(text);
  const errors = [];
  if (prefix.trim()) errors.push('unparsed text before first ECHO marker');
  const actual = blocks.map((b) => b.marker);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    errors.push('marker sequence mismatch');
    return errors;
  }
  for (const b of blocks) if (payloadRequired.has(b.marker) && !payloadPresent(b.payload)) errors.push(`empty payload:${b.marker}`);
  return errors;
}

function rcpPhase1() {
  const seq = []; const payload = new Set();
  const fields = ['ECHO_DOT', 'CONTACT_CATEGORY', 'PRIMITIVE_DESCRIPTOR', 'ADVANCED_DESCRIPTOR', 'FORMING'];
  for (let n = 1; n <= 6; n += 1) {
    seq.push(`RCP:TOUCH:${n}`);
    for (const f of fields) { seq.push(f); payload.add(f); }
  }
  return { seq, payload };
}

function rvSteps12() {
  const seq = []; const payload = new Set();
  const fields = ['RVL:ECHO_DOT', 'RVL:PRIMITIVE_DESCRIPTOR', 'RVL:ADVANCED_DESCRIPTOR', 'RVL:CONTACT_CATEGORY', 'RVL:FORMING'];
  for (let n = 1; n <= 6; n += 1) {
    seq.push(`RVL:TOUCH:${n}`);
    for (const f of fields) { seq.push(f); payload.add(f); }
  }
  for (let n = 1; n <= 3; n += 1) { seq.push(`RVL:VECTOR:${n}`); payload.add(`RVL:VECTOR:${n}`); }
  for (let n = 1; n <= 3; n += 1) { seq.push(`RVL:SKETCH:${n}`); payload.add(`RVL:SKETCH:${n}`); }
  return { seq, payload };
}

function telT1() {
  const seq = []; const payload = new Set();
  const fields = ['TEL:ECHO_DOT', 'TEL:CONTACT_CATEGORY', 'TEL:PRIMITIVE_DESCRIPTOR', 'TEL:ADVANCED_DESCRIPTOR', 'TEL:FORMING'];
  for (let n = 1; n <= 3; n += 1) {
    seq.push(`TEL:T1:TOUCH:${n}`);
    for (const f of fields) { seq.push(f); payload.add(f); }
  }
  return { seq, payload };
}

function parseT10(text) {
  const pattern = /([^.!?\n]+[.!?])\s*\[SRC:([^\]]+)\]/gu;
  const rows = []; const errors = []; let pos = 0;
  for (const m of String(text).matchAll(pattern)) {
    if (String(text).slice(pos, m.index).trim()) errors.push('T10 contains unsourced or unparsable text');
    rows.push({ sentence: m[1].trim(), refs: m[2].split(',').map((x) => x.trim()).filter(Boolean) });
    pos = m.index + m[0].length;
  }
  if (String(text).slice(pos).trim()) errors.push('T10 contains unsourced or unparsable text');
  if (rows.length < 3 || rows.length > 5) errors.push('T10 must contain 3..5 sourced sentences');
  return { rows, errors };
}

export function validateResponse(validatorId, text, runtime = {}, supportVerifier = null) {
  const errors = []; let inferredEvent = null;
  if (validatorId === 'generic.nonempty.v1') {
    if (!String(text).trim()) errors.push('empty');
  } else if (validatorId === 'rcp.phase1.v1') {
    const { seq, payload } = rcpPhase1(); errors.push(...exactSequence(text, seq, payload));
  } else if (validatorId === 'rcp.phase2to4.v1') {
    errors.push(...exactSequence(text, ['RCP:RAPID_CONTACT', 'RCP:VECTOR_ORBIT', 'RCP:FUNCTIONAL_SKETCH']));
  } else if (validatorId === 'rcp.phase5.v1') {
    const { blocks, prefix } = parseEchoBlocks(text);
    if (prefix.trim()) errors.push('unparsed text before first ECHO marker');
    const base = ['RCP:5.1', 'RCP:5.2:T1', 'RCP:5.2:T2', 'RCP:5.2:T3', 'RCP:5.3'];
    const actual = blocks.map((b) => b.marker);
    if (JSON.stringify(actual.slice(0, base.length)) !== JSON.stringify(base)) errors.push('marker sequence mismatch');
    for (const b of blocks) if (!payloadPresent(b.payload)) errors.push(`empty payload:${b.marker}`);
    const moves = [];
    for (const marker of actual.slice(base.length)) {
      const m = /^RCP:5\.4:MOVE:(\d+)$/u.exec(marker);
      if (!m) errors.push(`unexpected marker:${marker}`); else moves.push(Number(m[1]));
    }
    if (moves.length && (moves.length < 2 || moves.length > 5)) errors.push('5.4 move count must be 2..5 when activated');
    if (moves.length && JSON.stringify(moves) !== JSON.stringify(Array.from({ length: moves.length }, (_, i) => i + 1))) errors.push('5.4 move numbering must be contiguous and ordered');
  } else if (validatorId === 'rcp.phase6.v1') {
    const { blocks, prefix } = parseEchoBlocks(text);
    if (prefix.trim()) errors.push('unparsed text before first ECHO marker');
    const allowed = new Set(['RCP:6:NO_NEW_SIGNAL', 'RCP:6:NEW_SIGNAL']);
    if (blocks.length !== 1 || !allowed.has(blocks[0]?.marker)) errors.push('exactly one Phase 6 outcome required');
    else if (blocks[0].payload.trim()) errors.push('Phase 6 outcome marker must not carry payload');
    else inferredEvent = blocks[0].marker.endsWith('NO_NEW_SIGNAL') ? 'NO_NEW_SIGNAL' : 'NEW_SIGNAL';
  } else if (validatorId === 'rv-lite.steps1-2.v1') {
    const { seq, payload } = rvSteps12(); errors.push(...exactSequence(text, seq, payload));
  } else if (validatorId === 'rv-lite.step3-core.v1') {
    const { blocks, prefix } = parseEchoBlocks(text);
    if (prefix.trim()) errors.push('unparsed text before first ECHO marker');
    if (JSON.stringify(blocks.map((b) => b.marker)) !== JSON.stringify(['RVL:STEP3', 'RVL:STEP3:EXHAUSTED'])) errors.push('marker sequence mismatch');
    else if (!payloadPresent(blocks[0].payload)) errors.push('empty payload:RVL:STEP3');
  } else if (validatorId === 'rv-lite.step3-extended.v1') {
    const markers = ['RVL:STEP3', 'RVL:STEP3:EXHAUSTED', 'RVL:DEEPEN:MAIN_ASPECT', 'RVL:DEEPEN:MAIN_ACTIVITY', 'RVL:DEEPEN:CENTER', 'RVL:DEEPEN:SURROUNDINGS', 'RVL:DEEPEN:MAP'];
    const { blocks, prefix } = parseEchoBlocks(text);
    if (prefix.trim()) errors.push('unparsed text before first ECHO marker');
    if (JSON.stringify(blocks.map((b) => b.marker)) !== JSON.stringify(markers)) errors.push('marker sequence mismatch');
    else blocks.forEach((b, i) => { if (i !== 1 && !payloadPresent(b.payload)) errors.push(`empty payload:${b.marker}`); });
  } else if (validatorId === 'rv-lite.step4.v1') {
    const { blocks, prefix } = parseEchoBlocks(text);
    if (prefix.trim()) errors.push('unparsed text before first ECHO marker');
    if (!blocks.length) errors.push('missing functional sketch');
    const nums = [];
    for (const b of blocks) {
      const m = /^RVL:FUNCTIONAL_SKETCH:(\d+)$/u.exec(b.marker);
      if (!m) errors.push(`unexpected marker:${b.marker}`); else nums.push(Number(m[1]));
      if (!payloadPresent(b.payload)) errors.push(`empty payload:${b.marker}`);
    }
    if (nums.length && JSON.stringify(nums) !== JSON.stringify(Array.from({ length: nums.length }, (_, i) => i + 1))) errors.push('functional sketch numbering must be contiguous and ordered');
  } else if (validatorId === 'telepathy.t1.v1') {
    const { seq, payload } = telT1(); errors.push(...exactSequence(text, seq, payload));
  } else if (validatorId === 'telepathy.t2.v1') {
    errors.push(...exactSequence(text, ['TEL:T2:RAPID_CONTACT', 'TEL:T2:VECTOR_ORBIT', 'TEL:T2:FUNCTIONAL_SKETCH']));
  } else if (/^telepathy\.t[3-6]\.v1$/u.test(validatorId)) {
    const n = validatorId.match(/t([3-6])/u)[1]; errors.push(...exactSequence(text, [`TEL:T${n}:RAW`]));
  } else if (validatorId === 'telepathy.t7.v1') {
    errors.push(...exactSequence(text, Array.from({ length: 6 }, (_, i) => `TEL:T7:Q${i + 1}`)));
  } else if (validatorId === 'telepathy.t8.v1') {
    errors.push(...exactSequence(text, ['TEL:T8A', 'TEL:T8B']));
  } else if (validatorId === 'telepathy.t9.v1') {
    const q = Number(runtime.taskingQuestionCount ?? 0);
    if (!Number.isInteger(q) || q < 1) errors.push('runtime taskingQuestionCount required');
    else errors.push(...exactSequence(text, Array.from({ length: q }, (_, i) => `TEL:T9:Q${i + 1}:RAW`)));
  } else if (validatorId === 'telepathy.t10.v1') {
    const parsed = parseT10(text); errors.push(...parsed.errors);
    const valid = new Set(runtime.availableSourceSteps ?? []); const sources = runtime.sourceTextByStep ?? {};
    for (const row of parsed.rows) {
      if (!row.refs.length || row.refs.some((r) => !valid.has(r))) { errors.push('T10 invalid source reference'); continue; }
      if (row.refs.some((r) => !String(sources[r] ?? '').trim())) { errors.push('T10 cited source is missing or empty'); continue; }
      if (!supportVerifier) { errors.push('T10 semantic support verifier required'); continue; }
      const cited = row.refs.map((r) => String(sources[r])).join('\n');
      const status = supportVerifier(row.sentence, cited);
      if (status !== 'SUPPORTED') errors.push(`T10 support=${status}`);
    }
  } else if (validatorId === 'engine.blind-complete.v1') {
    if (runtime.engineEvent !== 'BLIND_COMPLETE') errors.push('missing engine BLIND_COMPLETE');
  } else errors.push('unknown validator');
  return { ok: errors.length === 0, errors, inferredEvent };
}
