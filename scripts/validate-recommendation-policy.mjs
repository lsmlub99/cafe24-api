import { recommendationService } from '../services/recommendationService.js';

const CATEGORY_ID_BY_KEY = {
  sunscreen: 93,
  toner: 96,
  serum: 97,
  cream: 95,
  cushion: 170,
  bb: 161,
};

const FIXTURES = [
  // sunscreen category
  { product_no: 1001, product_name: 'Daily Light Sun Cream 50ml', categories: [{ category_no: 93 }], price: 18000, summary_description: 'light daily sun cream', simple_description: 'uv protection', review_count: 320, review_avg: 4.7, sales_count: 600 },
  { product_no: 1002, product_name: 'Hydra Sun Cream 50ml', categories: [{ category_no: 93 }], price: 19000, summary_description: 'hydrating sun cream for dry skin', simple_description: 'moisturizing', review_count: 250, review_avg: 4.6, sales_count: 500 },
  { product_no: 1003, product_name: 'Outdoor Sun Lotion 60ml', categories: [{ category_no: 93 }], price: 21000, summary_description: 'light sun lotion for outdoor use', simple_description: 'summer outdoor', review_count: 190, review_avg: 4.5, sales_count: 420 },
  { product_no: 1004, product_name: 'Aqua Sun Spray 100ml', categories: [{ category_no: 93 }], price: 22000, summary_description: 'spray type sun product for easy reapply', simple_description: 'spray type', review_count: 410, review_avg: 4.8, sales_count: 1000 },
  { product_no: 1005, product_name: 'Aqua Sun Stick 19g', categories: [{ category_no: 93 }], price: 17000, summary_description: 'stick type sun product', simple_description: 'portable stick', review_count: 300, review_avg: 4.7, sales_count: 900 },
  { product_no: 1006, product_name: 'Tone Sun Serum 40ml', categories: [{ category_no: 93 }], price: 16800, summary_description: 'serum type sun care', simple_description: 'light serum', review_count: 280, review_avg: 4.5, sales_count: 870 },
  // toner
  { product_no: 2001, product_name: 'Calming Toner 200ml', categories: [{ category_no: 96 }], price: 22000, summary_description: 'sensitive calming toner', simple_description: 'low irritation', review_count: 280, review_avg: 4.8, sales_count: 510 },
  { product_no: 2002, product_name: 'Hydra Toner 300ml', categories: [{ category_no: 96 }], price: 17000, summary_description: 'daily hydration toner', simple_description: 'moisture finish', review_count: 210, review_avg: 4.5, sales_count: 470 },
  // cushion
  { product_no: 3001, product_name: 'Glow Cushion 15g', categories: [{ category_no: 170 }], price: 32000, summary_description: 'new cushion launch', simple_description: 'new item', created_date: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7).toISOString(), review_count: 80, review_avg: 4.4, sales_count: 110 },
  { product_no: 3002, product_name: 'Cover Cushion 15g', categories: [{ category_no: 170 }], price: 30000, summary_description: 'best cushion', simple_description: 'best seller', created_date: new Date(Date.now() - 1000 * 60 * 60 * 24 * 100).toISOString(), review_count: 430, review_avg: 4.7, sales_count: 900 },
  // cream/lotion category
  { product_no: 4001, product_name: 'Light Lotion 120ml', categories: [{ category_no: 95 }], price: 24000, summary_description: 'light lotion for summer', simple_description: 'fresh texture', review_count: 310, review_avg: 4.6, sales_count: 690 },
  { product_no: 4002, product_name: 'Calming Lotion 120ml', categories: [{ category_no: 95 }], price: 26000, summary_description: 'calming lotion for sensitive skin', simple_description: 'less oily finish', review_count: 180, review_avg: 4.5, sales_count: 410 },
  // cross-sell candidates
  { product_no: 5001, product_name: 'Barrier Serum 40ml', categories: [{ category_no: 97 }], price: 29000, summary_description: 'good combo serum', simple_description: 'secondary candidate', review_count: 140, review_avg: 4.5, sales_count: 350 },
  { product_no: 5002, product_name: 'Tone-up BB Cream 30ml', categories: [{ category_no: 161 }], price: 23000, summary_description: 'bb base option', simple_description: 'secondary candidate', review_count: 200, review_avg: 4.3, sales_count: 390 },
];

const TEST_CASES = [
  { query: '선크림 추천해줘', expected_main_forms: ['cream', 'lotion'] },
  { query: '건성 선크림 추천해줘', expected_main_forms: ['cream', 'lotion'] },
  { query: '민감성 토너 추천', expected_main_forms: ['toner'] },
  { query: '신상 쿠션 추천해줘', expected_main_forms: ['cushion'] },
  { query: '여름에 가벼운 로션 추천', expected_main_forms: ['lotion', 'cream'] },
];

function toArgs(query) {
  const parsed = recommendationService.parse_user_request({ q: query, query });
  const id = parsed.requested_category ? CATEGORY_ID_BY_KEY[parsed.requested_category] : null;
  return {
    query,
    args: {
      q: query,
      query,
      category: query,
      target_category_ids: id ? [id] : [],
      category_aliases: parsed.requested_category ? [parsed.requested_category] : [],
    },
  };
}

function hasCategoryMismatch(mains, requestedCategory, requestedIds) {
  if (!requestedCategory) return false;
  return mains.some((item) => {
    if (requestedIds.length > 0) {
      const ids = Array.isArray(item?.category_ids) ? item.category_ids : [];
      return !ids.some((id) => requestedIds.includes(Number(id)));
    }
    return item?.category_key && item.category_key !== requestedCategory;
  });
}

function hasFormMismatch(mains, expectedForms = []) {
  if (!Array.isArray(expectedForms) || !expectedForms.length) return false;
  return mains.some((item) => item?.form && !expectedForms.includes(item.form));
}

async function run() {
  const report = [];

  for (const tc of TEST_CASES) {
    const { query, args } = toArgs(tc.query);
    const result = await recommendationService.scoreAndFilterProducts(FIXTURES, args, 3);

    const requestedCategory = result.requested_category;
    const mains = Array.isArray(result.main_recommendations) ? result.main_recommendations : [];
    const secondaries = Array.isArray(result.secondary_recommendations) ? result.secondary_recommendations : [];
    const requestedIds = args.target_category_ids || [];

    const categoryMismatch = hasCategoryMismatch(mains, requestedCategory, requestedIds);
    const formMismatch = hasFormMismatch(mains, tc.expected_main_forms);
    const pass = !categoryMismatch && !formMismatch;

    report.push({
      query,
      requested_category: requestedCategory,
      expected_main_forms: tc.expected_main_forms,
      main_count: mains.length,
      secondary_count: secondaries.length,
      main_names: mains.map((x) => x.name),
      main_forms: mains.map((x) => x.form || null),
      main_category_keys: mains.map((x) => x.category_key || null),
      pass_category_lock: !categoryMismatch,
      pass_form_policy: !formMismatch,
      pass,
      notes: pass
        ? 'PASS'
        : categoryMismatch
        ? 'FAIL: main_recommendations contains out-of-category item.'
        : 'FAIL: main_recommendations contains form outside expected forms.',
    });
  }

  console.log(JSON.stringify({ report, metrics: recommendationService.getMetricsSnapshot() }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

