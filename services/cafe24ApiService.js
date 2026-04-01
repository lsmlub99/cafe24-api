import { config } from '../config/env.js';

// === [고도화 1단계] 인메모리(In-Memory) 캐시 저장소 구축 ===
// API 호출을 남발하지 않고 서버 메모리에 잠시 저장하여 속도를 100배 이상 단축시킵니다.
const cacheMem = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5분(300,000ms) 유지

/**
 * 접속 토큰을 활용한 상점 API 연동 서비스
 * 향후 주문 조회(orders), 회원 조회 등 카페24 각 도메인 별 API 로직 추가 위치입니다.
 */
export const cafe24ApiService = {

  // 기능 안내 테스트용 - 최신 상품 목록 가져오기 제한(limit) 5개
  getProducts: async (accessToken, limit = 5) => {
    // 진열 상태(display=T) 및 판매 중(selling=T)인 최신 상품만 가져와 단종/과거 데이터 제외
    const url = `https://${config.MALL_ID}.cafe24api.com/api/v2/admin/products?limit=${limit}&display=T&selling=T`;

    // 1. 캐시 히트(Cache Hit) 검사: 5분 이내에 똑같은 질문을 또 했다면 카페24에 요청 안 하고 0.01초 만에 즉시 반환
    const cachedData = cacheMem.get(url);
    if (cachedData && (Date.now() - cachedData.timestamp < CACHE_TTL_MS)) {
        console.log(`[Cache HIT ⚡] 실시간 통신 생략하고 서버 메모리에서 초고속으로 꺼냅니다! (부하 방어 완료)`);
        return cachedData.data;
    }

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
      // 카페24에서 보내준 진짜 원인(만료 에러 등)을 면밀히 추출해서 던짐
      const detail = data?.error?.message || JSON.stringify(data);
      const error = new Error(`상품 조회 통신 에러 발생: ${detail}`);
      error.status = response.status;
      error.data = data;
      throw error;
    }

    // 2. 캐시 세팅(Cache Set): 새롭게 가져온 데이터를 메모리에 5분짜리 유통기한을 달아 쾅 박아둠
    cacheMem.set(url, { data: data, timestamp: Date.now() });
    console.log(`[Cache SET 💾] 새로운 실시간 상품 정보를 가져와 5분간 자체 방어막(캐시)에 보관합니다.`);

    return data;
  },

  // === [고도화 업데이트] 쇼핑몰 공식 "베스트/카테고리" 랭킹 그대로 가져오기 ===
  // 카페24 관리자 센터에서 설정한 특정 카테고리(베스트셀러 등) 번호(categoryNo)를 넣으면 쇼핑몰 프론트와 똑같은 순서대로 빼옵니다.
  getCategoryProducts: async (accessToken, categoryNo, limit = 10) => {
    const url = `https://${config.MALL_ID}.cafe24api.com/api/v2/admin/categories/${categoryNo}/products?limit=${limit}&display=T&selling=T`;

    const cachedData = cacheMem.get(url);
    if (cachedData && (Date.now() - cachedData.timestamp < CACHE_TTL_MS)) {
        console.log(`[Cache HIT ⚡] 베스트 카테고리(${categoryNo}) 랭킹 조회 캐시 반환`);
        return cachedData.data;
    }

    console.log(`[INFO] 카테고리 상품 조회 통신 시작 (GET ${url})`);
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Cafe24-Api-Version': '2023-09-01' 
      }
    });

    const data = await response.json();

    if (!response.ok) {
      const detail = data?.error?.message || JSON.stringify(data);
      const error = new Error(`카테고리 랭킹 통신 에러: ${detail}`);
      error.status = response.status;
      throw error;
    }

    cacheMem.set(url, { timestamp: Date.now(), data });
    return data;
  }
};
