import Token from '../models/Token.js';

/**
 * [운영 대응 완료] MongoDB Atlas 연동
 * 더이상 서버가 재시작되거나 Render가 슬립 모드에 빠져도 데이터가 끊기지 않습니다.
 */
export const tokenStore = {
  // 특정 상점(mall_id)의 토큰 정보를 비동기(DB)로 갱신하고 영구 보관
  saveTokens: async (mall_id, access, refresh, expires) => {
    try {
      await Token.findOneAndUpdate(
        { mall_id },
        {
          accessToken: access,
          refreshToken: refresh,
          expiresAt: expires
        },
        { upsert: true, new: true } // 없으면 새로 생성, 있으면 업데이트
      );
      console.log(`[INFO] MongoDB에 ${mall_id} 토큰 정보가 영구 저장되었습니다.`);
    } catch (e) {
      console.error(`[ERROR] MongoDB 토큰 저장 실패:`, e.message);
    }
  },

  // 전체 토큰 조회 비동기 처리
  getTokens: async (mall_id) => {
    try {
      const doc = await Token.findOne({ mall_id });
      if (!doc) return { accessToken: null, refreshToken: null, expiresAt: null };
      return {
        accessToken: doc.accessToken,
        refreshToken: doc.refreshToken,
        expiresAt: doc.expiresAt
      };
    } catch (e) {
      console.error(`[ERROR] DB 토큰 조회 중 에러:`, e);
      return { accessToken: null, refreshToken: null, expiresAt: null };
    }
  },

  // 개별 엑세스 토큰만 조회 (비동기)
  getAccessToken: async (mall_id) => {
    try {
      const doc = await Token.findOne({ mall_id });
      return doc ? doc.accessToken : null;
    } catch (e) {
      return null;
    }
  },

  // 개별 리프레시 토큰만 조회 (비동기)
  getRefreshToken: async (mall_id) => {
    try {
      const doc = await Token.findOne({ mall_id });
      return doc ? doc.refreshToken : null;
    } catch (e) {
      return null;
    }
  }
};
