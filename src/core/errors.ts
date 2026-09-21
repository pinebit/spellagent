export class HelperError extends Error {
  constructor(readonly code: string, readonly details: Readonly<Record<string, unknown>> = {}) { super(code); }
}
