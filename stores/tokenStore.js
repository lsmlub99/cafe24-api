/**
 * [운영 전환 포인트] 다중 상점 확장이 고려된 토큰 저장소
 * mall_id를 기준으로 토큰 정보를 그룹화하여 저장합니다.
 * 실서비스 시 관계형 데이터베이스(MySQL, PostgreSQL 등)나 Redis로 교체가 필요합니다.
 */
const storeMap = new Map();

export const tokenStore = {
  // 특정 상점(mall_id)의 토큰 정보를 갱신 (DB의 INSERT/UPDATE에 해당)
  saveTokens: (mall_id, access, refresh, expires) => {
    storeMap.set(mall_id, {
      accessToken: access,
      refreshToken: refresh,
      expiresAt: expires
    });
  },
  
  // 전체 토큰 조회 실패 시 빈 객체 반환 보호 로직
  getTokens: (mall_id) => {
    return storeMap.get(mall_id) || {
      accessToken: null,
      refreshToken: null,
      expiresAt: null
    };
  },
  
  // 개별 토큰 접근 유틸리티
  getAccessToken: (mall_id) => {
    const data = storeMap.get(mall_id);
    return data ? data.accessToken : null;
  },
  
  getRefreshToken: (mall_id) => {
    const data = storeMap.get(mall_id);
    return data ? data.refreshToken : null;
  }
};
