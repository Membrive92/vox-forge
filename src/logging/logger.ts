/**
 * Frontend logger with levels, ring buffer, sessionStorage persistence,
 * and global error capture.
 *
 * The buffer (500 entries) is written to sessionStorage on every log so
 * it survives page reloads. It clears when the browser tab is closed.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context: Record<string, unknown> | undefined;
  requestId: string | undefined;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const BUFFER_LIMIT = 500;
const STORAGE_KEY = "voxforge.logs.buffer";

function loadBuffer(): LogEntry[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LogEntry[];
    return Array.isArray(parsed) ? parsed.slice(-BUFFER_LIMIT) : [];
  } catch {
    return [];
  }
}

function persistBuffer(buffer: LogEntry[]): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(buffer));
  } catch {
    // sessionStorage full or unavailable — drop silently
  }
}

class Logger {
  private buffer: LogEntry[] = loadBuffer();
  private minLevel: LogLevel = "debug";
  private listeners = new Set<(entry: LogEntry) => void>();

  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  subscribe(listener: (entry: LogEntry) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getBuffer(): readonly LogEntry[] {
    return this.buffer;
  }

  clear(): void {
    this.buffer = [];
    persistBuffer(this.buffer);
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log("debug", message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log("info", message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log("warn", message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.log("error", message, context);
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context: context && Object.keys(context).length > 0 ? context : undefined,
      requestId: typeof context?.["requestId"] === "string" ? (context["requestId"] as string) : undefined,
    };

    this.buffer.push(entry);
    if (this.buffer.length > BUFFER_LIMIT) {
      this.buffer.splice(0, this.buffer.length - BUFFER_LIMIT);
    }
    persistBuffer(this.buffer);

    const prefix = `[${entry.timestamp}] [${level.toUpperCase()}]`;
    const args: unknown[] = [prefix, message];
    if (entry.context) args.push(entry.context);
    switch (level) {
      case "debug": console.debug(...args); break;
      case "info":  console.info(...args);  break;
      case "warn":  console.warn(...args);  break;
      case "error": console.error(...args); break;
    }

    for (const listener of this.listeners) listener(entry);
  }
}

export const logger = new Logger();

let globalHandlersInstalled = false;

export function installGlobalErrorHandlers(): void {
  if (globalHandlersInstalled) return;
  globalHandlersInstalled = true;

  window.addEventListener("error", (event) => {
    logger.error("Uncaught error", {
      message: event.message,
      source: event.filename,
      line: event.lineno,
      column: event.colno,
      stack: event.error instanceof Error ? event.error.stack : undefined,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    logger.error("Unhandled promise rejection", {
      reason: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });
}
