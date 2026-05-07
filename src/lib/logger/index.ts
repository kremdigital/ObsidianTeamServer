import { join } from 'node:path';
import pino, { type Logger, type LoggerOptions, type TransportTargetOptions } from 'pino';

const isProd = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';
const level = process.env.LOG_LEVEL ?? (isProd ? 'info' : 'debug');
const logDir = process.env.LOG_DIR ?? './logs';

/**
 * The kind of logger — used as a `base.kind` field and as a hint for the
 * production file name. Tests / dev print to the console regardless.
 */
export type LoggerKind = 'web' | 'audit' | 'socket' | 'audit-socket';

const ROTATION_SIZE = '100m';
const ROTATION_FREQ = 'daily';
const ROTATION_LIMIT = 14;

function rotatedTarget(file: string): TransportTargetOptions {
  return {
    target: 'pino-roll',
    options: {
      file: join(logDir, file),
      size: ROTATION_SIZE,
      frequency: ROTATION_FREQ,
      limit: { count: ROTATION_LIMIT },
      mkdir: true,
      dateFormat: 'yyyy-MM-dd',
    },
    level,
  };
}

function buildLogger(kind: LoggerKind, fileName: string): Logger {
  if (isTest) {
    // Quiet logger for tests — silent by default.
    return pino({ level: 'silent' });
  }

  if (!isProd) {
    return pino({
      level,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:HH:MM:ss',
          ignore: 'pid,hostname',
        },
      },
      base: { kind },
    });
  }

  // Production: rotated file via pino-roll worker.
  const options: LoggerOptions = { level, base: { kind } };
  return pino(options, pino.transport(rotatedTarget(fileName)));
}

const isSocketProcess = process.env.OSYNC_PROCESS === 'socket';
const mainFile = isSocketProcess ? 'socket.log' : 'web.log';
const auditFile = isSocketProcess ? 'audit-socket.log' : 'audit.log';

export const logger: Logger = buildLogger(isSocketProcess ? 'socket' : 'web', mainFile);
export const auditLogger: Logger = buildLogger(
  isSocketProcess ? 'audit-socket' : 'audit',
  auditFile,
);

export function child(bindings: Record<string, unknown>): Logger {
  return logger.child(bindings);
}
