export class HelperError extends Error {
  constructor(readonly code: string) { super(code); }
}
