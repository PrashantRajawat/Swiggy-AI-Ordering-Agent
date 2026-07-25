type LogLevel = "info" | "warn" | "error" | "debug";

const levelWeight: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const configuredLevel = (process.env.LOG_LEVEL as LogLevel | undefined) ?? "info";

function shouldLog(level: LogLevel): boolean {
  return levelWeight[level] >= levelWeight[configuredLevel];
}

function format(level: LogLevel, message: string, meta?: unknown): string {
  const ts = new Date().toISOString();
  const base = `[${ts}] [${level.toUpperCase()}] ${message}`;
  if (meta === undefined) {
    return base;
  }
  return `${base} ${JSON.stringify(meta)}`;
}

export const logger = {
  info: (message: string, meta?: unknown): void => {
    if (shouldLog("info")) console.log(format("info", message, meta));
  },
  warn: (message: string, meta?: unknown): void => {
    if (shouldLog("warn")) console.warn(format("warn", message, meta));
  },
  error: (message: string, meta?: unknown): void => {
    if (shouldLog("error")) console.error(format("error", message, meta));
  },
  debug: (message: string, meta?: unknown): void => {
    if (shouldLog("debug")) console.debug(format("debug", message, meta));
  },
};
