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
  // sunscreen
  { product_no: 1001, product_name: '데일리 라이트 선크림 50ml', categories: [{ category_no: 93 }], price: 18000, summary_description: '산뜻 가벼운 데일리 선크림', simple_description: '자외선 차단', review_count: 320, review_avg: 4.7, sales_count: 600 },
  { product_no: 1002, product_name: '수분 밸런스 선크림 50ml', categories: [{ category_no: 93 }], price: 19000, summary_description: '건성 보습 촉촉한 선크림', simple_description: '건성 추천', review_count: 250, review_avg: 4.6, sales_count: 500 },
  { product_no: 1003, product_name: '야외 액티브 선로션 60ml', categories: [{ category_no: 93 }], price: 21000, summary_description: '야외 활동 가벼운 선로션', simple_description: '여름 활동성', review_count: 190, review_avg: 4.5, sales_count: 420 },
  // toner
  { product_no: 2001, product_name: '저자극 카밍 토너 200ml', categories: [{ category_no: 96 }], price: 22000, summary_description: '민감 피부 진정 토너', simple_description: '저자극 수분', review_count: 280, review_avg: 4.8, sales_count: 510 },
  { product_no: 2002, product_name: '데일리 수분 토너 300ml', categories: [{ category_no: 96 }], price: 17000, summary_description: '수분 보충 데일리 토너', simple_description: '촉촉한 마무리', review_count: 210, review_avg: 4.5, sales_count: 470 },
  // cushion
  { product_no: 3001, product_name: '글로우 쿠션 15g', categories: [{ category_no: 170 }], price: 32000, summary_description: '쿠션 베이스', simple_description: '신제품 런칭', created_date: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7).toISOString(), review_count: 80, review_avg: 4.4, sales_count: 110 },
  { product_no: 3002, product_name: '커버 쿠션 15g', categories: [{ category_no: 170 }], price: 30000, summary_description: '커버력 쿠션', simple_description: '베스트셀러', created_date: new Date(Date.now() - 1000 * 60 * 60 * 24 * 100).toISOString(), review_count: 430, review_avg: 4.7, sales_count: 900 },
  // cream/lotion
  { product_no: 4001, product_name: '가벼운 수분 로션 120ml', categories: [{ category_no: 95 }], price: 24000, summary_description: '여름 가벼운 로션', simple_description: '산뜻한 사용감', review_count: 310, review_avg: 4.6, sales_count: 690 },
  { product_no: 4002, product_name: '진정 밸런스 로션 120ml', categories: [{ category_no: 95 }], price: 26000, summary_description: '민감 진정 로션', simple_description: '끈적임 적음', review_count: 180, review_avg: 4.5, sales_count: 410 },
  // secondary pool
  { product_no: 5001, product_name: '수분 장벽 세럼 40ml', categories: [{ category_no: 97 }], price: 29000, summary_description: '함께 쓰기 좋은 세럼', simple_description: '보조 추천', review_count: 140, review_avg: 4.5, sales_count: 350 },
  { product_no: 5002, product_name: '피부결 정돈 토너 패드', categories: [{ category_no: 96 }], price: 23000, summary_description: '함께 쓰기 좋은 토너', simple_description: '보조 추천', review_count: 200, review_avg: 4.3, sales_count: 390 },
];

const TEST_CASES = [
  '선크림 추천해줘',
  '건성 선크림 추천해줘',
  '민감성 토너 추천',
  '신상 쿠션 추천해줘',
  '여름에 가벼운 로션 추천',
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

async function run() {
  const report = [];

  for (const text of TEST_CASES) {
    const { query, args } = toArgs(text);
    const result = await recommendationService.scoreAndFilterProducts(FIXTURES, args, 3);
    const requestedCategory = result.requested_category;
    const mains = Array.isArray(result.main_recommendations) ? result.main_recommendations : [];
    const secondaries = Array.isArray(result.secondary_recommendations) ? result.secondary_recommendations : [];

    const hasLock = Boolean(requestedCategory);
    const requestedIds = args.target_category_ids || [];
    const mismatch = hasLock
      ? mains.some((item) => {
          if (requestedIds.length > 0) {
            const ids = Array.isArray(item?.category_ids) ? item.category_ids : [];
            return !ids.some((id) => requestedIds.includes(Number(id)));
          }
          return item?.category_key && item.category_key !== requestedCategory;
        })
      : false;

    report.push({
      query,
      requested_category: requestedCategory,
      main_count: mains.length,
      secondary_count: secondaries.length,
      main_names: mains.map((x) => x.name),
      main_category_keys: mains.map((x) => x.category_key || null),
      pass_category_lock: hasLock ? !mismatch : true,
      notes: hasLock
        ? mismatch
          ? 'FAIL: main_recommendations contains out-of-category item.'
          : 'PASS'
        : 'NO_CATEGORY_LOCK_REQUIRED',
    });
  }

  console.log(JSON.stringify({ report, metrics: recommendationService.getMetricsSnapshot() }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
