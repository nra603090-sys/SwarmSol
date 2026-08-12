// ============================================
// SwarmSol - File 3: SwarmLogger
// Production-grade logging with Console & File transports
// ============================================

import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';

// ----------------------------------------------------
// 1. Log Level Enum & Configuration
// ----------------------------------------------------
export enum LogLevel {
  TRACE = 0,
  DEBUG = 1,
  INFO  = 2,
  WARN  = 3,
  ERROR = 4,
  SILENT = 5,
}

export interface LoggerConfig {
  /** Agent/module name (used in prefix) */
  name: string;
  /** Minimum log level to output */
  level?: LogLevel;
  /** Use JSON format (good for production log aggregators) */
  json?: boolean;
  /** Custom timestamp format (default: 'HH:mm:ss.SSS') */
  timestampFormat?: string;
  /** Enable colors in console output (default: true) */
  colors?: boolean;
}

// ----------------------------------------------------
// 2. Internal Defaults & Helpers
// ----------------------------------------------------
const DEFAULT_CONFIG: Partial<LoggerConfig> = {
  level: process.env.NODE_ENV === 'production' ? LogLevel.INFO : LogLevel.DEBUG,
  json: process.env.NODE_ENV === 'production',
  timestampFormat: 'HH:mm:ss.SSS',
  colors: true,
};

function formatTime(date: Date, format: string): string {
  const h = date.getHours().toString().padStart(2, '0');
  const m = date.getMinutes().toString().padStart(2, '0');
  const s = date.getSeconds().toString().padStart(2, '0');
  const ms = date.getMilliseconds().toString().padStart(3, '0');
  // Simple substitution
  return format
    .replace('HH', h)
    .replace('mm', m)
    .replace('ss', s)
    .replace('SSS', ms);
}

function emojiForLevel(level: LogLevel): string {
  switch (level) {
    case LogLevel.TRACE: return '🔎';
    case LogLevel.DEBUG: return '🐛';
    case LogLevel.INFO:  return '📡';
    case LogLevel.WARN:  return '⚠️';
    case LogLevel.ERROR: return '🔥';
    default: return '';
  }
}

function colorForLevel(level: LogLevel): (text: string) => string {
  switch (level) {
    case LogLevel.TRACE: return chalk.gray;
    case LogLevel.DEBUG: return chalk.blue;
    case LogLevel.INFO:  return chalk.white;
    case LogLevel.WARN:  return chalk.yellow;
    case LogLevel.ERROR: return chalk.red;
    default: return chalk.white;
  }
}

// ----------------------------------------------------
// 3. Main Logger Class
// ----------------------------------------------------
export class SwarmLogger {
  private name: string;
  private level: LogLevel;
  private json: boolean;
  private tsFormat: string;
  private useColors: boolean;
  private filePath: string | null = null;

  constructor(config: LoggerConfig) {
    const merged = { ...DEFAULT_CONFIG, ...config };
    this.name = merged.name!;
    this.level = merged.level!;
    this.json = merged.json!;
    this.tsFormat = merged.timestampFormat!;
    this.useColors = merged.colors!;
  }

  /**
   * Create a child logger (e.g., for sub-agents)
   */
  child(childName: string, overrides?: Partial<LoggerConfig>): SwarmLogger {
    return new SwarmLogger({
      name: `${this.name}:${childName}`,
      level: this.level,
      json: this.json,
      timestampFormat: this.tsFormat,
      colors: this.useColors,
      ...overrides,
    });
  }

  /**
   * Change minimum log level dynamically
   */
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  /**
   * Enable file logging (appends to a file)
   */
  enableFileLogging(filepath: string): void {
    // Ensure directory exists
    const dir = path.dirname(filepath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.filePath = filepath;
  }

  /**
   * Disable file logging
   */
  disableFileLogging(): void {
    this.filePath = null;
  }

  // ---- Public logging methods ----
  trace(msg: string, ...args: unknown[]): void { this.log(LogLevel.TRACE, msg, ...args); }
  debug(msg: string, ...args: unknown[]): void { this.log(LogLevel.DEBUG, msg, ...args); }
  info(msg: string, ...args: unknown[]): void  { this.log(LogLevel.INFO, msg, ...args); }
  warn(msg: string, ...args: unknown[]): void  { this.log(LogLevel.WARN, msg, ...args); }
  error(msg: string, ...args: unknown[]): void { this.log(LogLevel.ERROR, msg, ...args); }

  // ---- Core log method ----
  private log(level: LogLevel, message: string, ...args: unknown[]): void {
    if (level < this.level) return;

    const timestamp = new Date();
    const timeStr = formatTime(timestamp, this.tsFormat);

    if (this.json) {
      this.logJson(level, timestamp, message, args);
    } else {
      this.logConsole(level, timeStr, message, args);
    }

    // Also write to file if enabled
    if (this.filePath) {
      this.logFile(level, timeStr, message, args);
    }
  }

  // ---- Private: Console output (pretty) ----
  private logConsole(level: LogLevel, timeStr: string, message: string, args: unknown[]): void {
    const emoji = emojiForLevel(level);
    const color = colorForLevel(level);
    const prefix = chalk.cyan(`[${this.name}]`);
    const coloredMsg = color(`${message}${args.length ? ' ' + args.join(' ') : ''}`.trimEnd());
    const line = `${chalk.gray(timeStr)} ${emoji} ${prefix} ${coloredMsg}`;

    if (level >= LogLevel.ERROR) console.error(line);
    else if (level >= LogLevel.WARN) console.warn(line);
    else console.log(line);
  }

  // ---- Private: JSON output (for production) ----
  private logJson(level: LogLevel, timestamp: Date, message: string, args: unknown[]): void {
    const entry = {
      ts: timestamp.toISOString(),
      level: LogLevel[level].toLowerCase(),
      agent: this.name,
      msg: message,
      args: args.length ? args : undefined,
    };
    console.log(JSON.stringify(entry));
  }

  // ---- Private: File output ----
  private logFile(level: LogLevel, timeStr: string, message: string, args: unknown[]): void {
    try {
      const plainLine = `${timeStr} [${LogLevel[level]}] [${this.name}] ${message} ${args.length ? args.join(' ') : ''}`.trimEnd();
      fs.appendFileSync(this.filePath!, plainLine + '\n', 'utf-8');
    } catch (err) {
      // Silently fail file logging to avoid crashing the app
      console.error(`Logger: Failed to write to log file: ${err}`);
    }
  }
}

// ----------------------------------------------------
// 4. Pre-configured Agent Loggers
// ----------------------------------------------------
export const appLogger = new SwarmLogger({ name: 'SwarmSol' });
export const scoutLogger = appLogger.child('Scout');
export const riskLogger = appLogger.child('RiskAnalyzer');
export const executorLogger = appLogger.child('Executor');
export const orchestratorLogger = appLogger.child('Orchestrator');
export const connectionLogger = appLogger.child('Connection');

// ----------------------------------------------------
// 5. Quick Test & Example Usage (commented out)
// ----------------------------------------------------
/*
// Enable file logging (optional)
appLogger.enableFileLogging('./logs/swarmsol.log');

appLogger.info('System initialized');
scoutLogger.debug('Scanning Raydium pools...');
riskLogger.info('Groq analysis complete, net profit: $0.12');
executorLogger.warn('Slippage tolerance adjusted to 0.5%');
executorLogger.error('Bundle simulation failed!');
orchestratorLogger.info('Swarm loop running every 2000ms');

// Child logger example
const alphaScout = scoutLogger.child('Alpha');
alphaScout.info('Started');
*/
