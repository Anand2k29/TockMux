/** An error with a human-friendly fix hint. The CLI prints these without a stack trace. */
export class TockError extends Error {
  constructor(message, { hint = "", code = "TOCK_ERROR", exitCode = 1 } = {}) {
    super(message);
    this.name = "TockError";
    this.hint = hint;
    this.code = code;
    this.exitCode = exitCode;
  }
}
