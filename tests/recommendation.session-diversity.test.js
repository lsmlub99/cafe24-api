import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendationService } from '../services/recommendationService.js';

function buildProduct({
  id,
  name,
  summary = '',
  price = 16000,
  review_count = 0,
  rating = 0,
  sales_count = 0,
}) {
  return {
    product_no: String(id),
    product_name: name,
    category_ids: [93],
    price,
    review_count,
    rating,
    sales_count,
    summary_description: summary,
    search_preview: `${name} ${summary}`,
    attributes: { concern_tags: [], role_tags: [] },
  };
}

function overlapCount(a = [], b = []) {
  const set = new Set((a || []).map((x) => String(x || '')));
  return (b || []).filter((x) => set.has(String(x || ''))).length;
}

function topBaseNames(res, count = 2) {
  return (res.main_recommendations || []).slice(0, count).map((item) => item.base_name);
}

test('후속 조건 질의는 조건 적합도 우선 + 반복 완화 보조 정책을 따른다', async () => {
  const products = [
    buildProduct({ id: 1, name: 'Classic Sunscreen Cream A 50ml', review_count: 500, rating: 4.9, sales_count: 1000 }),
    buildProduct({ id: 2, name: 'Classic Sunscreen Lotion B 50ml', review_count: 420, rating: 4.8, sales_count: 900 }),
    buildProduct({ id: 3, name: 'Classic Sunscreen Cream C 50ml', review_count: 350, rating: 4.7, sales_count: 800 }),
    buildProduct({ id: 4, name: 'Hydra Sunscreen Cream D 50ml', summary: 'hydration moist soothing for dry skin', review_count: 20, rating: 4.2, sales_count: 40 }),
    buildProduct({ id: 5, name: 'Moist Sunscreen Lotion E 50ml', summary: 'hydration soothing daily for dry skin', review_count: 15, rating: 4.1, sales_count: 30 }),
    buildProduct({ id: 6, name: 'Calming Sunscreen Cream F 50ml', summary: 'hydration calming soothing', review_count: 10, rating: 4.0, sales_count: 20 }),
  ];

  const sessionKey = 'test-diversity-condition-priority';
  const first = await recommendationService.scoreAndFilterProducts(products, { query: '선크림 추천해주세요', __session_key: sessionKey }, 3);
  const firstTop2 = topBaseNames(first, 2);

  const second = await recommendationService.scoreAndFilterProducts(products, { query: '건성이면 뭐가 좋아요?', __session_key: sessionKey }, 3);
  const secondTop2 = topBaseNames(second, 2);

  assert.equal(second.requested_category, 'sunscreen');
  assert.equal(overlapCount(firstTop2, secondTop2) < 2, true);
  assert.equal(
    (second.main_recommendations || []).some((item) =>
      ['Hydra Sunscreen Cream D 50ml', 'Moist Sunscreen Lotion E 50ml', 'Calming Sunscreen Cream F 50ml'].includes(item.name)
    ),
    true
  );
  assert.equal(
    (second.main_recommendations || []).some((item) => ['cream', 'lotion'].includes(item.form)),
    true
  );
});

test('후속 조건 질의에서 신규 후보가 부족하면 기존 main 재사용을 허용한다', async () => {
  const products = [
    buildProduct({ id: 11, name: 'Classic Sunscreen Cream A 50ml', review_count: 500, rating: 4.9, sales_count: 1000 }),
    buildProduct({ id: 12, name: 'Classic Sunscreen Lotion B 50ml', review_count: 420, rating: 4.8, sales_count: 900 }),
    buildProduct({ id: 13, name: 'Classic Sunscreen Cream C 50ml', review_count: 350, rating: 4.7, sales_count: 800 }),
    buildProduct({ id: 14, name: 'Hydra Sunscreen Cream D 50ml', summary: 'hydration moist soothing for dry skin', review_count: 20, rating: 4.2, sales_count: 40 }),
  ];

  const sessionKey = 'test-diversity-fallback-with-seen';
  const first = await recommendationService.scoreAndFilterProducts(products, { query: '선크림 추천해주세요', __session_key: sessionKey }, 3);
  const firstBases = (first.main_recommendations || []).map((item) => item.base_name);

  const second = await recommendationService.scoreAndFilterProducts(products, { query: '건성이면 뭐가 좋아요?', __session_key: sessionKey }, 3);
  const secondBases = (second.main_recommendations || []).map((item) => item.base_name);

  assert.equal(second.requested_category, 'sunscreen');
  assert.equal(overlapCount(firstBases, secondBases) > 0, true);
});

