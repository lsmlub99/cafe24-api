import Token from '../models/Token.js';
import { logger } from '../utils/logger.js';

const tokenCache = new Map();

export const tokenStore = {
  async saveTokens(mallId, accessToken, refreshToken, expiresAt) {
    try {
      tokenCache.set(mallId, { accessToken, refreshToken, expiresAt });

      await Token.findOneAndUpdate(
        { mall_id: mallId },
        { accessToken, refreshToken, expiresAt },
        { upsert: true, returnDocument: 'after' }
      );

      logger.tokenVerbose(`[Token] persisted mall_id=${mallId}`);
    } catch (error) {
      logger.error('[Token] MongoDB save failed:', error.message);
    }
  },

  async getTokens(mallId) {
    if (tokenCache.has(mallId)) return tokenCache.get(mallId);

    try {
      const doc = await Token.findOne({ mall_id: mallId });
      if (!doc) return { accessToken: null, refreshToken: null, expiresAt: null };

      const tokens = {
        accessToken: doc.accessToken,
        refreshToken: doc.refreshToken,
        expiresAt: doc.expiresAt,
      };

      tokenCache.set(mallId, tokens);
      return tokens;
    } catch (error) {
      logger.error('[Token] DB read failed:', error.message);
      return { accessToken: null, refreshToken: null, expiresAt: null };
    }
  },

  async getAccessToken(mallId) {
    const tokens = await tokenStore.getTokens(mallId);
    return tokens.accessToken;
  },

  async getRefreshToken(mallId) {
    const tokens = await tokenStore.getTokens(mallId);
    return tokens.refreshToken;
  },

  async isExpired(mallId) {
    const tokens = await tokenStore.getTokens(mallId);
    if (!tokens.expiresAt) return true;

    const BUFFER_MS = 5 * 60 * 1000;
    return tokens.expiresAt - Date.now() < BUFFER_MS;
  },
};
