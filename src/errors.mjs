export class EchoError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'EchoError';
    this.code = code;
    this.details = details;
  }
}

export function invariant(condition, code, message, details) {
  if (!condition) throw new EchoError(code, message, details);
}
