/**
 * Exit-code contract: 0 success, 1 validation/runtime failure, 2 usage error.
 * Thrown CliErrors are caught once in bin.ts; everything else is a bug.
 */
export class CliError extends Error {
  readonly exitCode: 1 | 2

  constructor(message: string, exitCode: 1 | 2 = 1) {
    super(message)
    this.name = 'CliError'
    this.exitCode = exitCode
  }
}

export function usageError(message: string): CliError {
  return new CliError(message, 2)
}
