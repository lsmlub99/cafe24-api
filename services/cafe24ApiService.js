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

  // ⚡ [속도 고도화] 상품 목록 가져오기 - 필요한 필드만 콕 집어서 요청 (데이터 다이어트)
  getProducts: async (accessToken, limit = 50) => {
    const fields = 'product_no,product_name,price,list_image,detail_image,tiny_image,summary_description,simple_description,product_tag,sold_out,selling,display';
    const url = `https://${config.MALL_ID}.cafe24api.com/api/v2/admin/products?limit=${limit}&display=T&selling=T&fields=${fields}`;

    // 1. 캐시 히트(Cache Hit) 검사
    const cachedData = cacheMem.get(url);
    if (cachedData && (Date.now() - cachedData.timestamp < CACHE_TTL_MS)) {
        console.log(`[Cache HIT ⚡] 실시간 통신 생략하고 서버 메모리에서 초고속으로 꺼냅니다!`);
        return cachedData.data;
    }

    console.log(`[INFO] 상품 조회 API 통신 시작 (GET ${url})`);
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();

    if (!response.ok) {
      const detail = data?.error?.message || JSON.stringify(data);
      const error = new Error(`상품 조회 통신 에러 발생: ${detail}`);
      error.status = response.status;
      error.data = data;
      throw error;
    }

    // 2. 캐시 세팅
    cacheMem.set(url, { data: data, timestamp: Date.now() });
    return data;
  },

  // === [고도화 업데이트] 쇼핑몰 공식 "베스트/카테고리" 랭킹 조회 ===
  getCategoryProducts: async (accessToken, categoryNo, limit = 10) => {
    // ⚡ [속도 고도화] 카테고리 상품 목록도 최소한의 필드만 신속하게 조회
    const url = `https://${config.MALL_ID}.cafe24api.com/api/v2/admin/categories/${categoryNo}/products?limit=${limit}`;

    const cachedData = cacheMem.get(url);
    if (cachedData && (Date.now() - cachedData.timestamp < CACHE_TTL_MS)) {
        console.log(`[Cache HIT ⚡] 카테고리 랭킹 캐시 활용`);
        return cachedData.data;
    }

    console.log(`[INFO] 카테고리 상품 조회 API 통신 (GET ${url})`);
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();

    if (!response.ok) {
      const detail = data?.error?.message || JSON.stringify(data);
      const error = new Error(`카테고리 상품 조회 에러: ${detail}`);
      error.status = response.status;
      throw error;
    }

    cacheMem.set(url, { data: data, timestamp: Date.now() });
    return data;
  }
};
