import { config } from '../config/env.js';

// === [전역 캐시 저장소] ===
const cacheMem = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; 

/**
 * 🚀 [Ultra-Fast] 카페24 서비스 코어
 */
export const cafe24ApiService = {
  // 📦 [인메모리 싱크 저장소] 
  _allProductsSync: [],
  _lastSyncTime: 0,

  /**
   * [Sync 핵심] 백그라운드 전체 상품 동기화
   */
  async syncAllProducts(accessToken) {
    try {
        console.log(`[Sync] 🔄 백그라운드 싱크 가동...`);
        const fields = 'product_no,product_name,price,retail_price,list_image,detail_image,tiny_image,summary_description,simple_description,product_tag,sold_out,selling,display';
        const url = `https://${config.MALL_ID}.cafe24api.com/api/v2/admin/products?limit=100&display=T&selling=T&fields=${fields}`;
        
        const res = await fetch(url, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
        });
        const data = await res.json();

        if (data.products && data.products.length > 0) {
            cafe24ApiService._allProductsSync = data.products;
            cafe24ApiService._lastSyncTime = Date.now();
            console.log(`[Sync] ✅ 동기화 완료! (${data.products.length}개 상품 로드됨)`);
        }
        return data;
    } catch (e) {
        console.error(`[Sync Error]:`, e.message);
        return { products: cafe24ApiService._allProductsSync }; 
    }
  },

  /**
   * ⚡ [Main] 상품 목록 가져오기 (메모리 우선 / API 폴백)
   */
  getProducts: async (accessToken, limit = 100, keyword = '') => {
    const syncData = cafe24ApiService._allProductsSync;

    if (syncData && syncData.length > 0) {
        console.log(`[Memory Engine 🔥] '${keyword || '전체'}' 통합 분석 시작...`);
        
        if (!keyword) return { products: syncData.slice(0, limit) };
        
        const lowerKeyword = keyword.toLowerCase();
        const filtered = syncData.filter(p => 
            p.product_name.toLowerCase().includes(lowerKeyword) || 
            (p.summary_description && p.summary_description.toLowerCase().includes(lowerKeyword)) ||
            (p.product_tag && p.product_tag.some(t => t.toLowerCase().includes(lowerKeyword)))
        );

        return { products: filtered.length > 0 ? filtered : syncData };
    }

    console.log(`[API Fallback ⚠️] 실시간 API 호출 중...`);
    const fields = 'product_no,product_name,price,retail_price,list_image,detail_image,tiny_image,summary_description,simple_description,product_tag,sold_out,selling,display';
    let url = `https://${config.MALL_ID}.cafe24api.com/api/v2/admin/products?limit=${limit}&display=T&selling=T&fields=${fields}`;
    if (keyword) url += `&product_name=${encodeURIComponent(keyword)}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
    });
    return await response.json();
  },

  /**
   * 🏆 카테고리 랭킹 조회
   */
  getCategoryProducts: async (accessToken, categoryNo, limit = 10) => {
    const url = `https://${config.MALL_ID}.cafe24api.com/api/v2/admin/categories/${categoryNo}/products?limit=${limit}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
    });
    return await response.json();
  }
};
