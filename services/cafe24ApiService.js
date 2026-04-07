import { config } from '../config/env.js';
import { aiTaggingService } from './aiTaggingService.js';
import { tokenStore } from '../stores/tokenStore.js';
import { cafe24AuthService } from './cafe24AuthService.js';

/**
 * 📦 [Indestructible Module Memory] 
 * 객체 내부가 아닌 파일 레벨에 변수를 두어 'this' 참조 에러를 완벽하게 차단합니다.
 */
let allProductsSync = [];
let lastSyncTime = 0;
let lastSyncHash = '';

/**
 * [Sync] 백그라운드 싱크 (자동 토큰 갱신 포함)
 */
async function syncAllProducts(accessToken) {
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
            if (currentHash === lastSyncHash) {
                console.log(`[Sync Skip ✅]`);
                return { products: allProductsSync };
            }

            const aiTagsResults = await aiTaggingService.tagProducts(data.products);
            const enhancedProducts = data.products.map(p => {
                const foundTags = aiTagsResults.find(r => r.no === p.product_no);
                return { ...p, ai_tags: foundTags ? foundTags.tags : [] };
            });

            allProductsSync = enhancedProducts;
            lastSyncHash = currentHash;
            lastSyncTime = Date.now();
            console.log(`[Sync SUCCESS 🚀]`);
        }
        return data;
    } catch (e) {
        console.error(`[Sync Error]:`, e.message);
        return { products: allProductsSync || [] }; 
    }
}

/**
 * [Main] 상품 조회 (어떤 상황에서도 0개를 반환하지 않음)
 */
async function getProducts(accessToken, limit = 80, keyword = '') {
    try {
        const syncData = allProductsSync;
        if (syncData && syncData.length > 0) {
            console.log(`[Cache Hit 🔥]`);
            if (!keyword) return { products: syncData.slice(0, limit) };
            const lowerKeyword = keyword.toLowerCase();
            const filtered = syncData.filter(p => 
                p.product_name.toLowerCase().includes(lowerKeyword) || 
                (p.ai_tags && p.ai_tags.some(t => t.toLowerCase().includes(lowerKeyword)))
            );
            if (filtered.length > 0) return { products: filtered };
        }

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
        if (!data.products || data.products.length === 0) {
            const fallbackUrl = `https://${config.MALL_ID}.cafe24api.com/api/v2/admin/products?limit=${limit}&display=T&selling=T&fields=${fields}`;
            const fRes = await fetch(fallbackUrl, { headers: { 'Authorization': `Bearer ${targetToken}` } });
            return await fRes.json();
        }
        return data;
    } catch (err) {
        console.error(`[Fatal API Error]`, err.message);
        return { products: allProductsSync || [] };
    }
}

async function getCategoryProducts(accessToken, categoryNo, limit = 10) {
    const url = `https://${config.MALL_ID}.cafe24api.com/api/v2/admin/categories/${categoryNo}/products?limit=${limit}`;
    const response = await fetch(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
    return await response.json();
}

/**
 * 🚀 서비스 객체 수출
 */
export const cafe24ApiService = {
    syncAllProducts,
    getProducts,
    getCategoryProducts,
    get allProductsSync() { return allProductsSync; } // 외부 참조용 getter
};
