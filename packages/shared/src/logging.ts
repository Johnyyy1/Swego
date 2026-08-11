export type LogFields = Readonly<Record<string, unknown>>;

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

type LogLevel = "debug" | "info" | "warn" | "error";

export function createJsonLogger(baseFields: LogFields = {}): Logger {
  const write = (level: LogLevel, event: string, fields: LogFields = {}) => {
    const entry = JSON.stringify({
      ...baseFields,
      ...fields,
      timestamp: new Date().toISOString(),
      level,
      event,
    });

    if (level === "error") {
      console.error(entry);
    } else if (level === "warn") {
      console.warn(entry);
    } else {
      console.log(entry);
    }
  };

  return {
    debug: (event, fields) => write("debug", event, fields),
    info: (event, fields) => write("info", event, fields),
    warn: (event, fields) => write("warn", event, fields),
    error: (event, fields) => write("error", event, fields),
    child: (fields) => createJsonLogger({ ...baseFields, ...fields }),
  };
}

export function errorFields(error: unknown): LogFields {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
    };
  }

  return { errorMessage: String(error) };
}
