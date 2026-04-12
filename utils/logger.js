import { config } from '../config/env.js';

const LEVEL_ORDER = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 99,
};

const activeLevel = LEVEL_ORDER[String(config.LOG_LEVEL || 'info').toLowerCase()] ?? LEVEL_ORDER.info;

function canLog(level) {
  return LEVEL_ORDER[level] >= activeLevel;
}

export const logger = {
  debug: (...args) => {
    if (canLog('debug')) console.debug(...args);
  },
  info: (...args) => {
    if (canLog('info')) console.log(...args);
  },
  warn: (...args) => {
    if (canLog('warn')) console.warn(...args);
  },
  error: (...args) => {
    if (canLog('error')) console.error(...args);
  },
  mcpVerbose: (...args) => {
    if (config.LOG_MCP_VERBOSE && canLog('debug')) console.debug(...args);
  },
  cacheVerbose: (...args) => {
    if (config.LOG_CACHE_FILTER && canLog('debug')) console.debug(...args);
  },
  tokenVerbose: (...args) => {
    if (config.LOG_TOKEN_EVENTS && canLog('debug')) console.debug(...args);
  },
};
