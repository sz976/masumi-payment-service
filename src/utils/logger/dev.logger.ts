/* eslint-disable @typescript-eslint/no-base-to-string */
/* eslint-disable @typescript-eslint/restrict-template-expressions */
import { createLogger, format, transports } from 'winston';
import { TransformableInfo } from 'logform';
const { combine, timestamp, printf, errors } = format;

function buildDevLogger() {
  const logFormat = printf((info: TransformableInfo) => {
    const separator = '│';
    // Pad the level to maintain consistent width
    const paddedLevel = String(info.level).padEnd(7);

    // Handle error objects and their properties
    let mainMessage = info.message;
    if (info instanceof Error || (info.error && info.error instanceof Error)) {
      const error = info instanceof Error ? info : (info.error as Error);
      mainMessage = error.message || mainMessage;
    }

    // Handle stack traces
    if (info.stack) {
      const stackLines = String(info.stack).split('\n');
      return `${info.timestamp} ${separator} [${paddedLevel}] ${separator} ${mainMessage}\n${stackLines
        .slice(1)
        .map(
          (line: string) =>
            `${''.padStart(String(info.timestamp).length)} ${separator}            ${separator} ${line.trim()}`,
        )
        .join('\n')}`;
    }

    // Handle additional error properties
    let additionalInfo = '';
    if (typeof info.error === 'object' && info.error !== null) {
      const errorObj = info.error as Record<string, unknown>;
      const errorProps = Object.entries(errorObj)
        .filter(([key]) => key !== 'message' && key !== 'stack')
        .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
        .join(', ');
      if (errorProps) {
        additionalInfo = `\n${''.padStart(String(info.timestamp).length)} ${separator}            ${separator} Additional Details: ${errorProps}`;
      }
    }

    return `${info.timestamp} ${separator} [${paddedLevel}] ${separator} ${mainMessage}${additionalInfo}`;
  });

  return createLogger({
    format: combine(
      format.colorize({ all: false, level: true }),
      timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      errors({ stack: true }),
      format.splat(),
      logFormat,
    ),
    transports: [new transports.Console()],
  });
}

export { buildDevLogger };
