import dotenv from 'dotenv';

dotenv.config();

function toBool(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  return ['1', 'true', 'yes', 'y', 'on'].includes(String(value).toLowerCase());
}

export const config = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: process.env.PORT || 3000,
  MONGO_URI: process.env.MONGO_URI,
  MALL_ID: process.env.MALL_ID,
  CLIENT_ID: process.env.CLIENT_ID,
  CLIENT_SECRET: process.env.CLIENT_SECRET,
  REDIRECT_URI: process.env.REDIRECT_URI,
  SCOPE: process.env.SCOPE,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL || process.env.BASE_URL || '',
  RERANK_MODEL: process.env.RERANK_MODEL || 'gpt-4o-mini',
  LOG_LEVEL: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  LOG_MCP_VERBOSE: toBool(process.env.LOG_MCP_VERBOSE, false),
  LOG_CACHE_FILTER: toBool(process.env.LOG_CACHE_FILTER, false),
  LOG_TOKEN_EVENTS: toBool(process.env.LOG_TOKEN_EVENTS, false),
};

const requiredKeys = [
  'MALL_ID',
  'CLIENT_ID',
  'CLIENT_SECRET',
  'REDIRECT_URI',
  'SCOPE',
  'MONGO_URI',
  'OPENAI_API_KEY',
];

for (const key of requiredKeys) {
  if (!config[key]) {
    console.error(`[FATAL] Missing required environment variable: ${key}`);
    process.exit(1);
  }
}
