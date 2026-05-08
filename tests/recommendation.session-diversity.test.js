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

test('A. condition tie-band in follow-up promotes fresh over seen', async () => {
  const products = [
    buildProduct({ id: 1, name: 'Seen Cream A 50ml', review_count: 500, rating: 4.9, sales_count: 1000 }),
    buildProduct({ id: 2, name: 'Seen Cream B 50ml', review_count: 450, rating: 4.8, sales_count: 950 }),
    buildProduct({ id: 3, name: 'Fresh Spray C 100ml', summary: 'hydration soothing dry skin', review_count: 20, rating: 4.1, sales_count: 40 }),
    buildProduct({ id: 4, name: 'Fresh Stick D 19g', summary: 'hydration soothing dry skin', review_count: 15, rating: 4.0, sales_count: 30 }),
    buildProduct({ id: 5, name: 'Fresh Serum E 40ml', summary: 'pore control light serum', review_count: 25, rating: 4.2, sales_count: 50 }),
  ];

  const sessionKey = 'test-diversity-tie-promote';
  await recommendationService.scoreAndFilterProducts(products, { query: '선크림 추천해주세요', __session_key: sessionKey }, 3);
  const followUp = await recommendationService.scoreAndFilterProducts(products, { query: '건성에 좋은 선크림은요?', __session_key: sessionKey }, 3);

  const top2 = topBaseNames(followUp, 2);
  const seenTop2 = top2.filter((name) => ['Seen Cream A 50ml', 'Seen Cream B 50ml'].includes(name)).length;
  assert.equal(followUp.requested_category, 'sunscreen');
  assert.equal(seenTop2 < 2, true);
});

test('B. higher-condition fresh candidate should rank ahead of lower-condition fresh candidate', async () => {
  const products = [
    buildProduct({ id: 11, name: 'Seed Cream A 50ml', review_count: 400, rating: 4.7, sales_count: 700 }),
    buildProduct({ id: 12, name: 'Seed Cream B 50ml', review_count: 380, rating: 4.6, sales_count: 680 }),
    buildProduct({ id: 13, name: 'Hydra Stick Fresh 19g', summary: 'hydration soothing dry skin barrier', review_count: 20, rating: 4.2, sales_count: 40 }),
    buildProduct({ id: 14, name: 'Low Cond Serum Fresh 40ml', summary: 'light serum pore care', review_count: 18, rating: 4.1, sales_count: 35 }),
    buildProduct({ id: 15, name: 'Hydra Lotion Fresh 50ml', summary: 'hydration soothing dry skin', review_count: 22, rating: 4.3, sales_count: 45 }),
  ];

  const sessionKey = 'test-diversity-condition-priority-fresh';
  await recommendationService.scoreAndFilterProducts(products, { query: '선크림 추천해주세요', __session_key: sessionKey }, 3);
  const followUp = await recommendationService.scoreAndFilterProducts(products, { query: '건성 선크림 추천', __session_key: sessionKey }, 3);

  const names = (followUp.main_recommendations || []).map((x) => x.name);
  const idxStick = names.indexOf('Hydra Stick Fresh 19g');
  const idxSerum = names.indexOf('Low Cond Serum Fresh 40ml');
  if (idxStick >= 0 && idxSerum >= 0) assert.equal(idxStick < idxSerum, true);
  if (idxSerum >= 0) {
    const idxLotion = names.indexOf('Hydra Lotion Fresh 50ml');
    assert.equal(idxStick >= 0 || idxLotion >= 0, true);
    if (idxStick >= 0) assert.equal(idxStick < idxSerum, true);
    if (idxLotion >= 0) assert.equal(idxLotion < idxSerum, true);
  }
});

test('C. explicit form query keeps strict explicit policy and bypasses condition fresh guard', async () => {
  const products = [
    buildProduct({ id: 21, name: 'Sun Serum X 40ml', summary: 'sun serum', review_count: 50, rating: 4.5, sales_count: 200 }),
    buildProduct({ id: 22, name: 'Sun Cream Y 50ml', summary: 'sun cream', review_count: 80, rating: 4.6, sales_count: 250 }),
  ];

  const res = await recommendationService.scoreAndFilterProducts(products, { query: '선세럼 추천' }, 3);
  const forms = (res.main_recommendations || []).map((x) => x.form);
  assert.equal(res.applied_policy.requested_form, 'serum');
  assert.deepStrictEqual(res.applied_policy.allowed_main_forms, ['serum']);
  assert.equal(forms.every((x) => x === 'serum'), true);
});

test('D. follow-up condition query reduces exact top repeat when fresh fit candidates exist', async () => {
  const products = [
    buildProduct({ id: 31, name: 'Classic Sunscreen Cream A 50ml', review_count: 500, rating: 4.9, sales_count: 1000 }),
    buildProduct({ id: 32, name: 'Classic Sunscreen Lotion B 50ml', review_count: 420, rating: 4.8, sales_count: 900 }),
    buildProduct({ id: 33, name: 'Classic Sunscreen Cream C 50ml', review_count: 350, rating: 4.7, sales_count: 800 }),
    buildProduct({ id: 34, name: 'Hydra Sunscreen Cream D 50ml', summary: 'hydration moist soothing for dry skin', review_count: 20, rating: 4.2, sales_count: 40 }),
    buildProduct({ id: 35, name: 'Moist Sunscreen Lotion E 50ml', summary: 'hydration soothing daily for dry skin', review_count: 15, rating: 4.1, sales_count: 30 }),
    buildProduct({ id: 36, name: 'Calming Sunscreen Cream F 50ml', summary: 'hydration calming soothing', review_count: 10, rating: 4.0, sales_count: 20 }),
  ];

  const sessionKey = 'test-diversity-condition-followup';
  const first = await recommendationService.scoreAndFilterProducts(products, { query: '선크림 추천해주세요', __session_key: sessionKey }, 3);
  const firstTop2 = topBaseNames(first, 2);

  const second = await recommendationService.scoreAndFilterProducts(products, { query: '건성이면 뭐가 좋아요?', __session_key: sessionKey }, 3);
  const secondTop2 = topBaseNames(second, 2);

  assert.equal(second.requested_category, 'sunscreen');
  assert.equal(overlapCount(firstTop2, secondTop2) < 2, true);
});

test('E. when fresh candidates are insufficient, reintroducing seen items is allowed', async () => {
  const products = [
    buildProduct({ id: 41, name: 'Classic Sunscreen Cream A 50ml', review_count: 500, rating: 4.9, sales_count: 1000 }),
    buildProduct({ id: 42, name: 'Classic Sunscreen Lotion B 50ml', review_count: 420, rating: 4.8, sales_count: 900 }),
    buildProduct({ id: 43, name: 'Classic Sunscreen Cream C 50ml', review_count: 350, rating: 4.7, sales_count: 800 }),
    buildProduct({ id: 44, name: 'Hydra Sunscreen Cream D 50ml', summary: 'hydration moist soothing for dry skin', review_count: 20, rating: 4.2, sales_count: 40 }),
  ];

  const sessionKey = 'test-diversity-fallback-with-seen';
  const first = await recommendationService.scoreAndFilterProducts(products, { query: '선크림 추천해주세요', __session_key: sessionKey }, 3);
  const firstBases = (first.main_recommendations || []).map((item) => item.base_name);

  const second = await recommendationService.scoreAndFilterProducts(products, { query: '건성이면 뭐가 좋아요?', __session_key: sessionKey }, 3);
  const secondBases = (second.main_recommendations || []).map((item) => item.base_name);

  assert.equal(second.requested_category, 'sunscreen');
  assert.equal(overlapCount(firstBases, secondBases) > 0, true);
});
