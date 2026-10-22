export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export function createLogger(quiet = false): Logger {
  return {
    info(msg) {
      if (!quiet) process.stderr.write(`${msg}\n`);
    },
    warn(msg) {
      process.stderr.write(`warning: ${msg}\n`);
    },
    error(msg) {
      process.stderr.write(`error: ${msg}\n`);
    },
  };
}
