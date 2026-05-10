export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0, info: 1, warn: 2, error: 3,
};

export interface LoggerConfig {
  level: LogLevel;
  source?: string;
  enableTimestamp: boolean;
  enableJson: boolean;
}

/** Structured logger with configurable levels, JSON output, and source tracking */
export class Logger {
  private config: LoggerConfig;

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = {
      level: config.level ?? "info",
      source: config.source,
      enableTimestamp: config.enableTimestamp ?? true,
      enableJson: config.enableJson ?? false,
    };
  }

  setLevel(level: LogLevel): void {
    this.config.level = level;
  }

  child(source: string): Logger {
    return new Logger({ ...this.config, source });
  }

  debug(msg: string, meta?: Record<string, unknown>): void {
    this.log("debug", msg, meta);
  }

  info(msg: string, meta?: Record<string, unknown>): void {
    this.log("info", msg, meta);
  }

  warn(msg: string, meta?: Record<string, unknown>): void {
    this.log("warn", msg, meta);
  }

  error(msg: string, meta?: Record<string, unknown>): void {
    this.log("error", msg, meta);
  }

  private log(level: LogLevel, msg: string, meta?: Record<string, unknown>): void {
    if (LEVEL_RANK[level] < LEVEL_RANK[this.config.level]) return;
    const entry: Record<string, unknown> = { level, msg };
    if (this.config.source) entry.source = this.config.source;
    if (this.config.enableTimestamp) entry.timestamp = new Date().toISOString();
    if (meta) entry.meta = meta;
    const output = this.config.enableJson ? JSON.stringify(entry) : this.format(entry);
    this.emit(level, output);
  }

  private format(entry: Record<string, unknown>): string {
    const ts = entry.timestamp ? ` [${entry.timestamp}]` : "";
    const src = entry.source ? ` [${entry.source}]` : "";
    return `[${String(entry.level).toUpperCase()}]${ts}${src} ${entry.msg}`;
  }

  private emit(level: LogLevel, output: string): void {
    switch (level) {
      case "debug": console.debug(output); break;
      case "info": console.info(output); break;
      case "warn": console.warn(output); break;
      case "error": console.error(output); break;
    }
  }
}

/** Default application logger */
export const logger = new Logger({ level: "info", source: "aether" });
