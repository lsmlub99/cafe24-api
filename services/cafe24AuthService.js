import { config } from '../config/env.js';

export const cafe24AuthService = {
  getAuthorizeUrl: (state) => {
    const baseUrl = `https://${config.MALL_ID}.cafe24api.com/api/v2/oauth/authorize`;
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.CLIENT_ID,
      redirect_uri: config.REDIRECT_URI,
      scope: config.SCOPE,
      state
    });
    return `${baseUrl}?${params.toString()}`;
  },

  getAccessToken: async (code) => {
    const url = `https://${config.MALL_ID}.cafe24api.com/api/v2/oauth/token`;

    const payload = {
      grant_type: 'authorization_code',
      code: String(code),
      redirect_uri: config.REDIRECT_URI,
      client_id: config.CLIENT_ID,
      client_secret: config.CLIENT_SECRET
    };

    const body = new URLSearchParams(payload);

    console.log('=== TOKEN REQUEST DEBUG ===');
    console.log('TOKEN URL:', url);
    console.log('TOKEN PAYLOAD:', {
      grant_type: payload.grant_type,
      code_preview: `${String(code).slice(0, 6)}...`,
      redirect_uri: payload.redirect_uri,
      client_id: payload.client_id,
      client_secret_length: payload.client_secret?.length
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body
    });

    const rawText = await response.text();

    console.log('TOKEN RESPONSE STATUS:', response.status);
    console.log('TOKEN RESPONSE RAW:', rawText);

    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      throw new Error(`토큰 응답이 JSON이 아닙니다: ${rawText}`);
    }

    if (!response.ok) {
      throw new Error(`토큰 발급 실패: ${JSON.stringify(data)}`);
    }

    return data;
  },

  refreshAccessToken: async (refreshToken) => {
    const url = `https://${config.MALL_ID}.cafe24api.com/api/v2/oauth/token`;

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: config.CLIENT_ID,
      client_secret: config.CLIENT_SECRET
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(`토큰 재발급 실패: ${JSON.stringify(data)}`);
    }

    return data;
  }
};