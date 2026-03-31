import { config } from '../config/env.js';

/**
 * 접속 토큰을 활용한 상점 API 연동 서비스
 * 향후 주문 조회(orders), 회원 조회 등 카페24 각 도메인 별 API 로직 추가 위치입니다.
 */
export const cafe24ApiService = {
  
  // 기능 안내 테스트용 - 최신 상품 목록 가져오기 제한(limit) 5개
  getProducts: async (accessToken, limit = 5) => {
    const url = `https://${config.MALL_ID}.cafe24api.com/api/v2/admin/products?limit=${limit}`;
    
    console.log(`[INFO] 상품 조회 API 통신 시작 (GET ${url})`);
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`, // 헤더에 토큰 부여
        'Content-Type': 'application/json',
        // 카페24 API 버전이 변경되더라도 현 구조로 강제 고정 원할 시
        // 'X-Cafe24-Api-Version': '2023-03-01' 
      }
    });

    const data = await response.json();
    
    // 401 권한 없음 (만료), 404 없음, 400 파라미터 에러 등 핸들링
    if (!response.ok) {
      const error = new Error(`상품 조회 통신 에러 발생`);
      error.status = response.status; 
      error.data = data;
      throw error;
    }
    
    return data;
  }
};
