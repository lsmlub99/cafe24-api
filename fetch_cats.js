import { config } from './config/env.js';
import mongoose from 'mongoose';
import { tokenStore } from './stores/tokenStore.js';

async function run() {
  try {
    await mongoose.connect(config.MONGO_URI);
    const token = await tokenStore.getAccessToken(config.MALL_ID);
    const res = await fetch(`https://${config.MALL_ID}.cafe24api.com/api/v2/admin/categories`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    console.log(JSON.stringify(data.categories.map(c => ({no: c.category_no, name: c.category_name})), null, 2));
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}
run();
