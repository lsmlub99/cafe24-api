import { config } from './config/env.js';
import mongoose from 'mongoose';
import { tokenStore } from './stores/tokenStore.js';

async function run() {
  try {
    await mongoose.connect(config.MONGO_URI);
    const token = await tokenStore.getAccessToken(config.MALL_ID);
    
    // 상품 1개만 조회하여 category 필드의 실제 응답 형식 확인
    const fields = 'product_no,product_name,category';
    const url = `https://${config.MALL_ID}.cafe24api.com/api/v2/admin/products?limit=1&display=T&selling=T&fields=${fields}`;
    const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    
    console.log('=== 실제 Cafe24 API 응답 (category 필드) ===');
    console.log(JSON.stringify(data.products[0], null, 2));
    
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}
run();
