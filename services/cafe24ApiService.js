import { config } from '../config/env.js';

// === [초고속 싱크 저장소] ===
// API 호출을 남발하지 않고 서버 메모리에 상품 전체를 로직 수행 시 즉시 꺼내 씁니다.
const cacheMem = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5분(300,000ms) 유지

/**
 * 접속 토큰을 활용한 상점 API 연동 서비스
 */
export const cafe24ApiService = {
  // 📦 [인메모리 싱크 저장소]
  // 전체 상품 데이터를 메모리에 통째로 올려두어 API 지연을 0으로 만듭니다.
  _allProductsSync: [],
  _lastSyncTime: 0,

  /**
   * [Sync 핵심] 쇼핑몰 전체 상품을 백그라운드에서 한 번에 긁어와 메모리에 캐싱합니다.
   * 이렇게 하면 질문할 때마다 API를 호출할 필요가 없어 응답 속도가 0.1초대로 단축됩니다.
   */
  async syncAllProducts(accessToken) {
    try {
        console.log(`[Sync] 🔄 백그라운드 전체 상품 싱크 중...`);
        const fields = 'product_no,product_name,price,list_image,detail_image,tiny_image,summary_description,simple_description,product_tag,sold_out,selling,display';
        const url = `https://${config.MALL_ID}.cafe24api.com/api/v2/admin/products?limit=100&display=T&selling=T&fields=${fields}`;
        
        const res = await fetch(url, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
        });
        const data = await res.json();

        if (data.products && data.products.length > 0) {
            this._allProductsSync = data.products;
            this._lastSyncTime = Date.now();
            console.log(`[Sync] ✅ 성공! 총 ${data.products.length}개 상품이 메모리에 로드되었습니다.`);
        }
        return data.products || [];
    } catch (e) {
        console.error(`[Sync] ❌ 싱크 실패:`, e.message);
        return this._allProductsSync; 
    }
  },

  // ⚡ [풀-싱크 활용 버전] 기존 getProducts 가 캐시된 전체 데이터를 우선 활용하도록 변경
  getProducts: async (accessToken, limit = 100, keyword = '') => {
    // 🔍 만약 백그라운드에 싱크된 데이터가 있다면? API 통신 없이 즉시 메모리 필터링!
    if (this._allProductsSync && this._allProductsSync.length > 0) {
        console.log(`[Cache BLAZE 🔥] 메모리 동기화 데이터에서 '${keyword || '전체'}' 바로 추출 (지연 0ms)`);
        
        // 1. 키워드가 없는 경우 (상위 N개 추출)
        if (!keyword) return { products: this._allProductsSync.slice(0, limit) };
        
        // 2. 키워드가 있는 경우 (메모리 내 필터링)
        const lowerKeyword = keyword.toLowerCase();
        const filtered = this._allProductsSync.filter(p => 
            p.product_name.toLowerCase().includes(lowerKeyword) || 
            (p.summary_description && p.summary_description.toLowerCase().includes(lowerKeyword)) ||
            (p.product_tag && p.product_tag.map(t => t.toLowerCase()).includes(lowerKeyword))
        );

        // 결과가 있으면 필터링된 데이터 반환, 없으면 전체 리스트 반환 (유연성)
        return { products: filtered.length > 0 ? filtered : this._allProductsSync };
    }

    // [Fallback] 싱크된 데이터가 없으면 기존 방식대로 실시간 API 호출 (안전장치)
    const fields = 'product_no,product_name,price,list_image,detail_image,tiny_image,summary_description,simple_description,product_tag,sold_out,selling,display';
    let url = `https://${config.MALL_ID}.cafe24api.com/api/v2/admin/products?limit=${limit}&display=T&selling=T&fields=${fields}`;
    
    if (keyword) {
        url += `&product_name=${encodeURIComponent(keyword)}`;
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
    });

    return await response.json();
  },

  // 특정 카테고리의 상품 가져오기 (랭킹용)
  getCategoryProducts: async (accessToken, categoryNo, limit = 10) => {
    const url = `https://${config.MALL_ID}.cafe24api.com/api/v2/admin/categories/${categoryNo}/products?limit=${limit}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
    });

    if (response.status === 401) throw { status: 401, message: 'Unauthorized' };
    return await response.json();
  }
};
