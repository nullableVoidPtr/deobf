import winston from 'winston';
import { basename, dirname, extname } from 'node:path';

export function getPassName(filename: string) {
	const name = basename(filename, extname(filename));
	if (name == 'mod') {
		return basename(dirname(filename));
	}

	return name;
}

const myFormat = winston.format.printf(({ level, message, pass, timestamp }) => {
	let prefix = `${timestamp}`;
	if (pass) {
		prefix += ` [${pass}]`;
	}
	prefix += ` ${level}`;

	return `${prefix}: ${message}`;
});

const logger = winston.createLogger({
	level: 'info',
	format: winston.format.combine(
		winston.format.timestamp(),
		winston.format.errors({ stack: true }),
		winston.format.cli(),
		myFormat,
	),
	transports: [new winston.transports.Console({
		stderrLevels: ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'],
	})],
});

export default logger;