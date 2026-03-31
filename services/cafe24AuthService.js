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

    // [핵심 변경 사항] 카페24 공식 문서 스펙 준수: client_id:client_secret 을 Base64로 인코딩하여 Header에 삽입해야 합니다.
    const base64Credentials = Buffer.from(`${config.CLIENT_ID}:${config.CLIENT_SECRET}`).toString('base64');

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: String(code),
      redirect_uri: config.REDIRECT_URI
      // client_id, client_secret를 여기서 제거하고 Header로 이동
    });

    console.log(`[INFO] (getAccessToken) 통신 요청 준비 완료. Payload:`, body.toString());

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${base64Credentials}`, // 공식 문서 필수 항목
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(`토큰 발급 실패: ${JSON.stringify(data)}`);
    }

    return data;
  },

  refreshAccessToken: async (refreshToken) => {
    const url = `https://${config.MALL_ID}.cafe24api.com/api/v2/oauth/token`;

    // [핵심 변경 사항] 리프레시 토큰 요청 시에도 Basic Auth 필수
    const base64Credentials = Buffer.from(`${config.CLIENT_ID}:${config.CLIENT_SECRET}`).toString('base64');

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken
      // client_id, client_secret를 여기서 제거하고 Header로 이동
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${base64Credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(`토큰 재발급 실패: ${JSON.stringify(data)}`);
    }

    return data;
  }
};