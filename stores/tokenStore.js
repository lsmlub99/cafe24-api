import Token from '../models/Token.js';

// ⚡ [속도 고도화] 토큰 인메모리 캐시 도입
// 매번 외부 MongoDB에 접속하면 1~2초의 지연(Latency)이 발생할 수 있으므로,
// 서버 메모리에 한 번 로드된 토큰은 즉시 반환하여 응답 속도를 비약적으로 높입니다.
const _tokenCache = new Map();

/**
 * [운영 대응 완료] MongoDB Atlas 연동 + 인메모리 하이브리드 저장소
 */
export const tokenStore = {
  // 특정 상점(mall_id)의 토큰 정보를 메모리와 DB에 모두 저장
  saveTokens: async (mall_id, access, refresh, expires) => {
    try {
      // 1. 메모리 캐시 즉시 업데이트 (0.001초 미만)
      _tokenCache.set(mall_id, {
        accessToken: access,
        refreshToken: refresh,
        expiresAt: expires
      });

      // 2. MongoDB 영구 저장 (보존용)
      await Token.findOneAndUpdate(
        { mall_id },
        {
          accessToken: access,
          refreshToken: refresh,
          expiresAt: expires
        },
        { upsert: true, new: true }
      );
      console.log(`[Token] ${mall_id} 토큰이 메모리와 DB에 영구 저장되었습니다.`);
    } catch (e) {
      console.error(`[ERROR] MongoDB 토큰 저장 실패:`, e.message);
    }
  },

  // 전체 토큰 조회 (메모리 우선)
  getTokens: async (mall_id) => {
    // ⚡ [Fast Path] 메모리에 있으면 즉시 반환
    if (_tokenCache.has(mall_id)) {
        return _tokenCache.get(mall_id);
    }

    // [Slow Path] 없으면 DB 조회 후 메모리에 등록
    try {
      const doc = await Token.findOne({ mall_id });
      if (!doc) return { accessToken: null, refreshToken: null, expiresAt: null };
      
      const tokens = {
        accessToken: doc.accessToken,
        refreshToken: doc.refreshToken,
        expiresAt: doc.expiresAt
      };
      _tokenCache.set(mall_id, tokens);
      return tokens;
    } catch (e) {
      console.error(`[ERROR] DB 토큰 조회 중 에러:`, e);
      return { accessToken: null, refreshToken: null, expiresAt: null };
    }
  },

  // 개별 엑세스 토큰 조회 (메모리 우선)
  getAccessToken: async (mall_id) => {
    const tokens = await tokenStore.getTokens(mall_id);
    return tokens.accessToken;
  },

  // 개별 리프레시 토큰 조회 (메모리 우선)
  getRefreshToken: async (mall_id) => {
    const tokens = await tokenStore.getTokens(mall_id);
    return tokens.refreshToken;
  },

  // 🕒 [능동적 갱신] 토큰 만료 여부 확인 (만료 5분 전이면 true 반환)
  isExpired: async (mall_id) => {
    const tokens = await tokenStore.getTokens(mall_id);
    if (!tokens.expiresAt) return true;
    
    // 현재 시간보다 만료 시간이 이전이거나, 5분(300,000ms) 이내로 남았으면 만료로 간주
    const BUFFER_MS = 5 * 60 * 1000; 
    const now = Date.now();
    
    return (tokens.expiresAt - now < BUFFER_MS);
  }
};
