type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'log';

type LogEntry = {
  ts: string;
  level: LogLevel;
  args: string[];
};

const STORAGE_KEY = 'veillend.strict_log';
const MAX_ENTRIES = 600;
const SKIP_LOG_PREFIXES = [
  '[strict][sdk] refresh snapshot',
  '[strict][sdk] refresh (E2E)',
];

const serializeArg = (arg: unknown): string => {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return arg.message || String(arg);
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
};

const loadStoredLogs = (): LogEntry[] => {
  if (typeof localStorage === 'undefined') return [];
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as LogEntry[]) : [];
  } catch {
    return [];
  }
};

const persistLogs = (logs: LogEntry[]) => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
  } catch {
  }
};

export const installStrictLogCapture = () => {
  if (typeof window === 'undefined') return;
  const win = window as Window & {
    __VEILLEND_LOG_CAPTURED__?: boolean;
    __VEILLEND_STRICT_LOGS__?: LogEntry[];
    __VEILLEND_STRICT_LOGS_EXPORT__?: () => string;
  };
  if (win.__VEILLEND_LOG_CAPTURED__) return;
  win.__VEILLEND_LOG_CAPTURED__ = true;

  const logs = loadStoredLogs();
  win.__VEILLEND_STRICT_LOGS__ = logs;
  win.__VEILLEND_STRICT_LOGS_EXPORT__ = () => JSON.stringify(logs, null, 2);

  const shouldSkip = (args: unknown[]) =>
    args.some(
      (arg) => typeof arg === 'string' && SKIP_LOG_PREFIXES.some((prefix) => arg.includes(prefix)),
    );

  const push = (level: LogLevel, args: unknown[]) => {
    if (shouldSkip(args)) return;
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      args: args.map(serializeArg),
    };
    logs.push(entry);
    if (logs.length > MAX_ENTRIES) {
      logs.splice(0, logs.length - MAX_ENTRIES);
    }
    persistLogs(logs);
  };

  const wrap = <T extends (...args: unknown[]) => void>(
    level: LogLevel,
    original: T,
  ) =>
    (...args: Parameters<T>) => {
      push(level, args);
      original(...args);
    };

  console.debug = wrap('debug', console.debug.bind(console));
  console.info = wrap('info', console.info.bind(console));
  console.warn = wrap('warn', console.warn.bind(console));
  console.error = wrap('error', console.error.bind(console));
  console.log = wrap('log', console.log.bind(console));

  window.addEventListener('unhandledrejection', (event) => {
    push('error', ['unhandledrejection', event.reason]);
  });
  window.addEventListener('error', (event) => {
    push('error', ['error', event.message]);
  });
};
