import { config } from '../config/env.js';

/**
 * 카페24 인증 및 권한 제어 코어 서비스 (비즈니스 로직)
 */
export const cafe24AuthService = {
  // 1. 카페24 로그인(인가 코드 발급) 화면 URL 생성
  getAuthorizeUrl: (state) => {
    const baseUrl = `https://${config.MALL_ID}.cafe24api.com/api/v2/oauth/authorize`;
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.CLIENT_ID,
      redirect_uri: config.REDIRECT_URI, // 환경변수에서 설정된 https 도메인만 사용
      scope: config.SCOPE,
      state: state
    });
    return `${baseUrl}?${params.toString()}`;
  },

  // 2. 인가 코드로 실제 엑세스 토큰(Access Token) 발급
  getAccessToken: async (code) => {
    const url = `https://${config.MALL_ID}.cafe24api.com/api/v2/oauth/token`;
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      mall_id: config.MALL_ID,
      code: String(code),
      redirect_uri: config.REDIRECT_URI,
      client_id: config.CLIENT_ID,
      client_secret: config.CLIENT_SECRET
    });

    console.log("TOKEN REQUEST URL:", url);
    console.log("TOKEN REQUEST PAYLOAD:", {
      grant_type: 'authorization_code',
      mall_id: config.MALL_ID,
      code: String(code),
      redirect_uri: config.REDIRECT_URI,
      client_id: config.CLIENT_ID,
      client_secret_length: config.CLIENT_SECRET?.length
    });


    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });

    const data = await response.json();

    // 네트워크 실패 또는 토큰 교환 실패 에러 핸들링
    if (!response.ok) {
      throw new Error(`토큰 발급 실패: ${JSON.stringify(data)}`);
    }
    return data;
  },

  // 3. 만료된 엑세스 토큰을 대체하기 위한 재발급 요청(Refresh Token 사용)
  refreshAccessToken: async (refreshToken) => {
    const url = `https://${config.MALL_ID}.cafe24api.com/api/v2/oauth/token`;
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      mall_id: config.MALL_ID,
      refresh_token: refreshToken, // 보안상 새로 갱신될 수 있음
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
      throw new Error(`토큰/리프레시 재발급 실패: ${JSON.stringify(data)}`);
    }
    return data;
  }
};
