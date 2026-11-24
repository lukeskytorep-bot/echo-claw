import { resolveProtocol, stepById } from '../protocol-runtime.mjs';
import { EchoError } from '../errors.mjs';
import { canonicalMethodologyForStep } from './viewer-methodology.mjs';

const NO_SIGNAL = 'If no signal is present, state "no signal" inside the required payload instead of inventing data.';

function taskingLine(tasking, language) {
  if (language === 'pl') {
    return tasking.tasking_mode === 'neutral_code'
      ? `Kod celu: **${tasking.neutral_code}**. Traktuj go wyłącznie jako neutralny wyzwalacz. Nie szukaj w nim znaczenia ani wzorców.`
      : 'Cel został wybrany. Rozpocznij sesję. Celu nie nazywamy — tylko go opisujemy.';
  }
  return tasking.tasking_mode === 'neutral_code'
    ? `Target code: **${tasking.neutral_code}**. Treat it only as a neutral trigger. Do not infer meaning or patterns from it.`
    : 'The target has been selected. Begin the session. Do not name the target — only describe it.';
}

function markersFor(validatorId, runtime = {}) {
  if (validatorId === 'generic.nonempty.v1') return ['Return a short readiness/grounding response. Do not name or guess the target.'];
  if (validatorId === 'rcp.phase1.v1') {
    const out = [];
    for (let n=1;n<=6;n+=1) out.push(`[[ECHO:RCP:TOUCH:${n}]]`, '[[ECHO:ECHO_DOT]] <data>', '[[ECHO:CONTACT_CATEGORY]] <data>', '[[ECHO:PRIMITIVE_DESCRIPTOR]] <data>', '[[ECHO:ADVANCED_DESCRIPTOR]] <data>', '[[ECHO:FORMING]] <data>');
    return out;
  }
  if (validatorId === 'rcp.phase2to4.v1') return ['[[ECHO:RCP:RAPID_CONTACT]] <data>', '[[ECHO:RCP:VECTOR_ORBIT]] <data>', '[[ECHO:RCP:FUNCTIONAL_SKETCH]] <ASCII/data>'];
  if (validatorId === 'rcp.phase5.v1') return ['[[ECHO:RCP:5.1]] <movement/activity>', '[[ECHO:RCP:5.2:T1]] <data>', '[[ECHO:RCP:5.2:T2]] <data>', '[[ECHO:RCP:5.2:T3]] <data>', '[[ECHO:RCP:5.3]] <anomalies/signals>', 'Optional directional deepening only if activated: [[ECHO:RCP:5.4:MOVE:1]] ... through 2–5 contiguous moves.'];
  if (validatorId === 'rcp.phase6.v1') return ['Return exactly ONE empty marker and nothing else:', '[[ECHO:RCP:6:NO_NEW_SIGNAL]]', 'or', '[[ECHO:RCP:6:NEW_SIGNAL]]'];
  if (validatorId === 'rv-lite.steps1-2.v1') {
    const out=[];
    for(let n=1;n<=6;n+=1) out.push(`[[ECHO:RVL:TOUCH:${n}]]`, '[[ECHO:RVL:ECHO_DOT]] <data>', '[[ECHO:RVL:PRIMITIVE_DESCRIPTOR]] <data>', '[[ECHO:RVL:ADVANCED_DESCRIPTOR]] <data>', '[[ECHO:RVL:CONTACT_CATEGORY]] <data>', '[[ECHO:RVL:FORMING]] <data>');
    for(let n=1;n<=3;n+=1) out.push(`[[ECHO:RVL:VECTOR:${n}]] <data>`);
    for(let n=1;n<=3;n+=1) out.push(`[[ECHO:RVL:SKETCH:${n}]] <ASCII sketch>`);
    return out;
  }
  if (validatorId === 'rv-lite.step3-core.v1') return ['[[ECHO:RVL:STEP3]] <deepening data until signal exhausted>', '[[ECHO:RVL:STEP3:EXHAUSTED]]'];
  if (validatorId === 'rv-lite.step3-extended.v1') return ['[[ECHO:RVL:STEP3]] <deepening data until signal exhausted>', '[[ECHO:RVL:STEP3:EXHAUSTED]]', '[[ECHO:RVL:DEEPEN:MAIN_ASPECT]] <data>', '[[ECHO:RVL:DEEPEN:MAIN_ACTIVITY]] <data>', '[[ECHO:RVL:DEEPEN:CENTER]] <data>', '[[ECHO:RVL:DEEPEN:SURROUNDINGS]] <data>', '[[ECHO:RVL:DEEPEN:MAP]] <target map>'];
  if (validatorId === 'rv-lite.step4.v1') return ['Return one or more contiguous functional sketches:', '[[ECHO:RVL:FUNCTIONAL_SKETCH:1]] <ASCII/data>', 'then :2, :3, ... only if needed.'];
  if (validatorId === 'telepathy.t1.v1') {
    const out=[]; for(let n=1;n<=3;n+=1) out.push(`[[ECHO:TEL:T1:TOUCH:${n}]]`, '[[ECHO:TEL:ECHO_DOT]] <RAW>', '[[ECHO:TEL:CONTACT_CATEGORY]] <RAW>', '[[ECHO:TEL:PRIMITIVE_DESCRIPTOR]] <RAW>', '[[ECHO:TEL:ADVANCED_DESCRIPTOR]] <RAW>', '[[ECHO:TEL:FORMING]] <RAW>'); return out;
  }
  if (validatorId === 'telepathy.t2.v1') return ['[[ECHO:TEL:T2:RAPID_CONTACT]] <RAW>', '[[ECHO:TEL:T2:VECTOR_ORBIT]] <RAW>', '[[ECHO:TEL:T2:FUNCTIONAL_SKETCH]] <RAW/ASCII>'];
  const raw = /^telepathy\.t([3-6])\.v1$/u.exec(validatorId); if(raw) return [`[[ECHO:TEL:T${raw[1]}:RAW]] <RAW only>`];
  if (validatorId === 'telepathy.t7.v1') return Array.from({length:6},(_,i)=>`[[ECHO:TEL:T7:Q${i+1}]] <RAW answer>`);
  if (validatorId === 'telepathy.t8.v1') return ['[[ECHO:TEL:T8A]] <RAW>', '[[ECHO:TEL:T8B]] <RAW>'];
  if (validatorId === 'telepathy.t9.v1') return Array.from({length:Number(runtime.taskingQuestionCount??0)},(_,i)=>`[[ECHO:TEL:T9:Q${i+1}:RAW]] <RAW answer to frozen question ${i+1}>`);
  if (validatorId === 'telepathy.t10.v1') return ['Write exactly 3–5 short summary sentences. Every sentence must end with source tags, e.g. `... . [SRC:T1,T2]`. Use only information supported by cited blind steps. No new information.'];
  throw new EchoError('UNSUPPORTED_VIEWER_VALIDATOR', `no OpenClaw prompt contract for ${validatorId}`);
}

export function renderViewerPrompt({ session, tasking, telepathyQuestions = [], recoveryContext = null, adjuncts = [] }) {
  const protocol = resolveProtocol(session.protocol_id, session.protocol_version);
  const step = stepById(protocol, session.current_step_id);
  if (step.expected_output.validator_id === 'engine.blind-complete.v1') throw new EchoError('ENGINE_STEP', 'blind-complete is engine-owned');
  const language = session.language === 'pl' ? 'pl' : 'en';
  const methodology = canonicalMethodologyForStep({ session, tasking });
  const lines = [
    'ECHO-CLAW Viewer Session',
    `Protocol: ${protocol.id}@${protocol.version}`,
    `Step: ${step.step_id} (${step.source_anchor ?? step.kind})`,
    '',
    'CANONICAL METHODOLOGY — follow this method. The output contract below only structures your report and never replaces the method:',
    methodology,
    '',
    'Blindness rule: remain blind. Never infer, name, or guess the target beyond what the canonical protocol permits. Report raw perceptual/structural data.',
    NO_SIGNAL,
  ];
  if (step.step_id === 'rcp.phase1' || step.step_id === 'telepathy.t1') lines.push('', taskingLine(tasking, language));
  if (step.step_id === 'rcp.phase5') lines.push('', 'NORMATIVE ECHO RESOLUTION: if Phase 5.4 is activated, perform 2–5 contiguous directional moves. This 2–5 rule overrides the conflicting 1–3 wording in the historical source.');
  if (step.step_id === 'telepathy.t9') {
    lines.push('', 'Frozen neutral tasking questions:');
    telepathyQuestions.forEach((q,i)=>lines.push(`${i+1}. ${q.text}`));
  }
  if (recoveryContext?.accepted_results?.length) {
    lines.push('', 'RECOVERY CONTEXT — these are previously ACCEPTED blind outputs from this same ECHO session. Treat them only as continuity memory; do not rewrite them, do not infer the target from them, and continue from the current step:');
    for (const row of recoveryContext.accepted_results) lines.push(`--- ${row.step_id} / ${row.step_instance_id} ---\n${row.result_text}`);
  }
  if (adjuncts.length) {
    lines.push('', 'FROZEN NEUTRAL ADJUNCT PROBES — address them only within the current canonical phase, without replacing or skipping canonical requirements:');
    adjuncts.forEach((a,i)=>lines.push(`${i+1}. ${a.instruction_text}`));
  }
  lines.push('', 'OUTPUT CONTRACT: use the exact marker order below. Do not place prose outside the required structure.');
  lines.push(...markersFor(step.expected_output.validator_id, { taskingQuestionCount: telepathyQuestions.length }));
  return lines.join('\n');
}

const STOP = new Set(['the','a','an','and','or','of','to','in','on','at','is','are','was','were','be','been','with','for','from','this','that','it','as','i','you','he','she','they','we','but','się','i','oraz','lub','do','w','na','z','ze','jest','są','był','była','było','to','ten','ta','ale']);
function supportTokens(text) { return new Set(String(text).toLowerCase().normalize('NFKC').match(/[\p{L}\p{N}]{3,}/gu)?.filter((x)=>!STOP.has(x)) ?? []); }
export function strictT10SupportVerifier(sentence, citedText) {
  const claim = supportTokens(sentence); const source = supportTokens(citedText);
  if (!claim.size || !source.size) return 'UNSUPPORTED';
  // Fail closed: every content-bearing token in the summary sentence must already occur
  // in the cited blind material. This intentionally prefers rejection over semantic invention.
  for (const token of claim) if (!source.has(token)) return 'UNSUPPORTED';
  return 'SUPPORTED';
}
