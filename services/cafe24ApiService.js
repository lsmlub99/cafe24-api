import { config } from '../config/env.js';
import { aiTaggingService } from './aiTaggingService.js';

// === [전역 캐시 저장소] ===
const cacheMem = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; 

/**
 * 🚀 [Ultra-Fast + AI Intelligence] 카페24 서비스 코어
 */
export const cafe24ApiService = {
  // 📦 [인메모리 싱크 저장소]
  _allProductsSync: [],
  _lastSyncTime: 0,
  _lastSyncHash: '',

  /**
   * [Sync 핵심] 백그라운드 전체 상품 동기화 + AI 지능형 스킵
   */
  async syncAllProducts(accessToken) {
    try {
        console.log(`[Sync] 🔄 동기화 가동...`);
        const fields = 'product_no,product_name,price,retail_price,list_image,detail_image,tiny_image,summary_description,simple_description,product_tag,sold_out,selling,display';
        const url = `https://${config.MALL_ID}.cafe24api.com/api/v2/admin/products?limit=100&display=T&selling=T&fields=${fields}`;
        
        const res = await fetch(url, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
        });
        const data = await res.json();

        if (data.products && data.products.length > 0) {
            // 🛡️ [낭비 제로] 데이터 변경 여부 감지 (지문 검사)
            const currentHash = JSON.stringify(data.products.map(p => p.product_no + p.product_name + p.price));
            if (currentHash === cafe24ApiService._lastSyncHash) {
                console.log(`[Sync Skip ✅] 내용이 동일하여 AI 태깅(토큰 소모)을 건너뜁니다.`);
                cafe24ApiService._lastSyncTime = Date.now();
                return { products: cafe24ApiService._allProductsSync };
            }

            // 🤖 [AI 태깅] 데이터가 바뀌었을 때만 수행
            const aiTagsResults = await aiTaggingService.tagProducts(data.products);
            const enhancedProducts = data.products.map(p => {
                const foundTags = aiTagsResults.find(r => r.no === p.product_no);
                return { ...p, ai_tags: foundTags ? foundTags.tags : [] };
            });

            cafe24ApiService._allProductsSync = enhancedProducts;
            cafe24ApiService._lastSyncHash = currentHash;
            cafe24ApiService._lastSyncTime = Date.now();
            console.log(`[Sync SUCCESS 🚀] AI 태깅 완료!`);
        }
        return data;
    } catch (e) {
        console.error(`[Sync Error]:`, e.message);
        return { products: cafe24ApiService._allProductsSync }; 
    }
  },

  getProducts: async (accessToken, limit = 100, keyword = '') => {
    const syncData = cafe24ApiService._allProductsSync;

    if (syncData && syncData.length > 0) {
        console.log(`[Memory Engine 🔥] '${keyword || '전체'}' 통합 분석 시작...`);
        if (!keyword) return { products: syncData.slice(0, limit) };
        
        const lowerKeyword = keyword.toLowerCase();
        const filtered = syncData.filter(p => {
            // [지능형 매칭] 상품명뿐만 아니라 GPT가 달아준 AI 태그에서도 검색!
            const inName = p.product_name.toLowerCase().includes(lowerKeyword);
            const inTags = p.ai_tags && p.ai_tags.some(tag => tag.toLowerCase().includes(lowerKeyword));
            return inName || inTags;
        });

        return { products: filtered.length > 0 ? filtered : syncData };
    }

    // [Fallback] 실시간 API 호출 - 키워드 누락 방지!
    const fields = 'product_no,product_name,price,retail_price,list_image,detail_image,tiny_image,summary_description,simple_description,product_tag,sold_out,selling,display';
    let url = `https://${config.MALL_ID}.cafe24api.com/api/v2/admin/products?limit=${limit}&display=T&selling=T&fields=${fields}`;
    
    // 키워드가 있으면 상품명 검색 파라미터 추가
    if (keyword) {
        url += `&product_name=${encodeURIComponent(keyword)}`;
    }

    console.log(`[API Fallback 🛰️] 실시간 호출 중: ${url}`);
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
    });
    
    const data = await response.json();
    
    // 🛡️ [데이터 보장] 만약 특정 키워드로 검색했는데 0개가 나왔다면? 
    // AI가 멍청해지지 않도록 전체 리스트라도 반환합니다.
    if (!data.products || data.products.length === 0) {
        console.log(`[API Fallback ⚠️] '${keyword}' 결과 없음. 전체 데이터로 재시도...`);
        const allUrl = `https://${config.MALL_ID}.cafe24api.com/api/v2/admin/products?limit=${limit}&display=T&selling=T&fields=${fields}`;
        const allRes = await fetch(allUrl, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
        });
        return await allRes.json();
    }
    
    return data;
  },

  getCategoryProducts: async (accessToken, categoryNo, limit = 10) => {
    const url = `https://${config.MALL_ID}.cafe24api.com/api/v2/admin/categories/${categoryNo}/products?limit=${limit}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
    });
    return await response.json();
  }
};
