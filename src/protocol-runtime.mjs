import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EchoError } from './errors.mjs';

const runtimePath = fileURLToPath(new URL('../runtime/protocols.json', import.meta.url));
const runtime = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));

export function listProtocols() {
  return Object.values(runtime.protocols).map((p) => ({ id: p.id, version: p.version, manifest_sha256: p.manifest_sha256, status: p.status }));
}

export function resolveProtocol(protocolId, version) {
  const p = runtime.protocols[protocolId];
  if (!p) throw new EchoError('UNKNOWN_PROTOCOL', `unknown protocol ${protocolId}`);
  if (String(p.version) !== String(version)) throw new EchoError('UNKNOWN_PROTOCOL_VERSION', `unsupported version ${protocolId}@${version}`);
  return p;
}

export function stepById(protocol, stepId) {
  const step = protocol.steps.find((x) => x.step_id === stepId);
  if (!step) throw new EchoError('UNKNOWN_STEP', `unknown step ${stepId}`);
  return step;
}

export function stepInstanceId(stepId, cycleIndex) {
  if (!Number.isInteger(cycleIndex) || cycleIndex < 0) throw new EchoError('INVALID_CYCLE_INDEX', 'cycle index must be a non-negative integer');
  return `${stepId}~c${cycleIndex}`;
}

export function transitionFor(step, event) {
  const matches = step.transitions.filter((t) => t.event === event);
  if (matches.length !== 1) throw new EchoError('ILLEGAL_TRANSITION', `event ${event} is not legal from ${step.step_id}`);
  return matches[0];
}

export function defaultCompletionEvent(step, validation) {
  if (validation?.inferredEvent) return validation.inferredEvent;
  if (step.transitions.length === 1) return step.transitions[0].event;
  return null;
}
