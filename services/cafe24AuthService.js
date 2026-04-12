import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

export const cafe24AuthService = {
  getAuthorizeUrl: (state) => {
    const baseUrl = `https://${config.MALL_ID}.cafe24api.com/api/v2/oauth/authorize`;
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.CLIENT_ID,
      redirect_uri: config.REDIRECT_URI,
      scope: config.SCOPE,
      state,
    });
    return `${baseUrl}?${params.toString()}`;
  },

  getAccessToken: async (code) => {
    const url = `https://${config.MALL_ID}.cafe24api.com/api/v2/oauth/token`;
    const base64Credentials = Buffer.from(`${config.CLIENT_ID}:${config.CLIENT_SECRET}`).toString('base64');

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: String(code),
      redirect_uri: config.REDIRECT_URI,
    });

    logger.debug('[Auth] Requesting access token');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${base64Credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    const data = await response.json();
    if (!response.ok) throw new Error(`Token issue failed: ${JSON.stringify(data)}`);
    return data;
  },

  refreshAccessToken: async (refreshToken) => {
    const url = `https://${config.MALL_ID}.cafe24api.com/api/v2/oauth/token`;
    const base64Credentials = Buffer.from(`${config.CLIENT_ID}:${config.CLIENT_SECRET}`).toString('base64');

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });

    logger.debug('[Auth] Refreshing access token');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${base64Credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    const data = await response.json();
    if (!response.ok) throw new Error(`Token refresh failed: ${JSON.stringify(data)}`);
    return data;
  },
};
