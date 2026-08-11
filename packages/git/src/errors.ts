export class GitRepositoryError extends Error {
  override readonly name: string = "GitRepositoryError";
}

export class GitCommandError extends GitRepositoryError {
  override readonly name = "GitCommandError";
  readonly operation: string;
  readonly exitCode: number;

  constructor(operation: string, exitCode: number, stderr: string) {
    const detail = stderr.trim() || "Git exited without an error message";
    super(
      `Git operation '${operation}' failed with exit code ${exitCode}: ${detail}`,
    );
    this.operation = operation;
    this.exitCode = exitCode;
  }
}

export class GitFileTooLargeError extends GitRepositoryError {
  override readonly name = "GitFileTooLargeError";

  constructor(path: string, size: number, maxBytes: number) {
    super(
      `Refusing to read '${path}' (${size} bytes); limit is ${maxBytes} bytes`,
    );
  }
}
