import { config } from '../config/env.js';
import { aiTaggingService } from './aiTaggingService.js';
import { tokenStore } from '../stores/tokenStore.js';
import { cafe24AuthService } from './cafe24AuthService.js';

/**
 * 🚀 [Indestructible] 카페24 서비스 코어 
 * - 401 에러 시 자동 복구 로직 포함
 */
export const cafe24ApiService = {
  _allProductsSync: [],
  _lastSyncTime: 0,
  _lastSyncHash: '',

  /**
   * [Sync] 백그라운드 싱크 (자동 토큰 갱신 포함)
   */
  async syncAllProducts(accessToken) {
    try {
        console.log(`[Sync] 🔄 동기화 가동...`);
        const fields = 'product_no,product_name,price,retail_price,list_image,detail_image,tiny_image,summary_description,simple_description,product_tag,sold_out,selling,display';
        const url = `https://${config.MALL_ID}.cafe24api.com/api/v2/admin/products?limit=100&display=T&selling=T&fields=${fields}`;
        
        let targetToken = accessToken;
        let res = await fetch(url, {
            headers: { 'Authorization': `Bearer ${targetToken}`, 'Content-Type': 'application/json' }
        });

        // [401 자동 복구]
        if (res.status === 401) {
            console.log(`[Sync] 🔑 토큰 만료 감지 -> 즉시 갱신 시도`);
            const tokens = await tokenStore.getTokens(config.MALL_ID);
            const refreshData = await cafe24AuthService.refreshAccessToken(tokens.refreshToken);
            await tokenStore.saveTokens(config.MALL_ID, refreshData.access_token, refreshData.refresh_token, refreshData.expires_at);
            targetToken = refreshData.access_token;
            res = await fetch(url, { headers: { 'Authorization': `Bearer ${targetToken}`, 'Content-Type': 'application/json' } });
        }

        const data = await res.json();
        if (data.products && data.products.length > 0) {
            const currentHash = JSON.stringify(data.products.map(p => p.product_no + p.product_name + p.price));
            if (currentHash === cafe24ApiService._lastSyncHash) {
                console.log(`[Sync Skip ✅]`);
                return { products: cafe24ApiService._allProductsSync };
            }

            const aiTagsResults = await aiTaggingService.tagProducts(data.products);
            const enhancedProducts = data.products.map(p => {
                const foundTags = aiTagsResults.find(r => r.no === p.product_no);
                return { ...p, ai_tags: foundTags ? foundTags.tags : [] };
            });

            cafe24ApiService._allProductsSync = enhancedProducts;
            cafe24ApiService._lastSyncHash = currentHash;
            cafe24ApiService._lastSyncTime = Date.now();
            console.log(`[Sync SUCCESS 🚀]`);
        }
        return data;
    } catch (e) {
        console.error(`[Sync Error]:`, e.message);
        return { products: cafe24ApiService._allProductsSync }; 
    }
  },

  /**
   * [Main] 상품 조회 (어떤 상황에서도 0개를 반환하지 않음)
   */
  getProducts: async (accessToken, limit = 80, keyword = '') => {
    try {
        const syncData = cafe24ApiService._allProductsSync;
        // 메모리에 있으면 메모리에서 우선 반환
        if (syncData && syncData.length > 0) {
            console.log(`[Memory Base 🔥]`);
            if (!keyword) return { products: syncData.slice(0, limit) };
            const lowerKeyword = keyword.toLowerCase();
            const filtered = syncData.filter(p => 
                p.product_name.toLowerCase().includes(lowerKeyword) || 
                (p.ai_tags && p.ai_tags.some(t => t.toLowerCase().includes(lowerKeyword)))
            );
            if (filtered.length > 0) return { products: filtered };
        }

        // 실시간 API 호출 (401 복구 로직 포함)
        const fields = 'product_no,product_name,price,retail_price,list_image,detail_image,tiny_image,summary_description,simple_description,product_tag,sold_out,selling,display';
        let url = `https://${config.MALL_ID}.cafe24api.com/api/v2/admin/products?limit=${limit}&display=T&selling=T&fields=${fields}`;
        if (keyword) url += `&product_name=${encodeURIComponent(keyword)}`;

        let targetToken = accessToken;
        let response = await fetch(url, { headers: { 'Authorization': `Bearer ${targetToken}` } });

        if (response.status === 401) {
            console.log(`[Re-Auth] 🔑 실시간 호출 중 토큰 갱신...`);
            const tokens = await tokenStore.getTokens(config.MALL_ID);
            const r = await cafe24AuthService.refreshAccessToken(tokens.refreshToken);
            await tokenStore.saveTokens(config.MALL_ID, r.access_token, r.refresh_token, r.expires_at);
            targetToken = r.access_token;
            response = await fetch(url, { headers: { 'Authorization': `Bearer ${targetToken}` } });
        }

        const data = await response.json();
        
        // 🛡️ 무조건 상품 채우기 전략: 검색 결과가 0개면 전체 리스트라도 가져옴
        if (!data.products || data.products.length === 0) {
            const fallbackUrl = `https://${config.MALL_ID}.cafe24api.com/api/v2/admin/products?limit=${limit}&display=T&selling=T&fields=${fields}`;
            const fRes = await fetch(fallbackUrl, { headers: { 'Authorization': `Bearer ${targetToken}` } });
            return await fRes.json();
        }
        
        return data;
    } catch (err) {
        console.error(`[Fatal API Error]`, err.message);
        return { products: cafe24ApiService._allProductsSync || [] };
    }
  },

  getCategoryProducts: async (accessToken, categoryNo, limit = 10) => {
    const url = `https://${config.MALL_ID}.cafe24api.com/api/v2/admin/categories/${categoryNo}/products?limit=${limit}`;
    const response = await fetch(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
    return await response.json();
  }
};
