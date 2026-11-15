import pino, { type Logger, type LoggerOptions } from 'pino';

const REDACT_PATHS = [
  'access_token',
  'refresh_token',
  'accessToken',
  'refreshToken',
  'client_secret',
  'clientSecret',
  'authorization',
  'token',
  'password',
  'req.headers.authorization',
  'req.headers["x-hub-signature-256"]',
  'req.headers["x-ghl-signature"]',
  'req.headers["x-wh-signature"]',
  'req.headers["x-form-signature"]',
  'headers.authorization',
  'headers["x-hub-signature-256"]',
  '*.access_token',
  '*.refresh_token',
  '*.accessToken',
  '*.refreshToken',
  '*.client_secret',
  '*.clientSecret',
  '*.authorization',
  '*.token',
];

export function loggerOptions(level: string): LoggerOptions {
  return {
    level,
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: REDACT_PATHS,
      censor: '[Redacted]',
    },
  };
}

export function createLogger(level: string, dest?: pino.DestinationStream): Logger {
  return pino(loggerOptions(level), dest);
}

export type AppLogger = Logger;
