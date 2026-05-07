import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendationService } from '../services/recommendationService.js';

const MOCK_PRODUCTS = [
  {
    product_no: '101',
    product_name: 'Daily Sun Cream 50ml',
    category_ids: [93],
    price: 16000,
    summary_description: 'daily sunscreen cream uv protection',
    search_preview: 'daily sunscreen cream',
    attributes: { concern_tags: ['hydration'], role_tags: ['daily'] },
  },
  {
    product_no: '102',
    product_name: 'Light Sun Lotion 50ml',
    category_ids: [93],
    price: 17000,
    summary_description: 'light sun lotion daily use',
    search_preview: 'sun lotion',
    attributes: { concern_tags: ['hydration'], role_tags: ['daily'] },
  },
  {
    product_no: '103',
    product_name: 'Tone Up Sun Serum 40ml',
    category_ids: [93],
    price: 22000,
    summary_description: 'tone up cover sun serum',
    search_preview: 'tone up sun serum',
    attributes: { concern_tags: ['tone_up'], role_tags: ['cover'] },
  },
  {
    product_no: '104',
    product_name: 'Portable Sun Stick 19g',
    category_ids: [93],
    price: 17000,
    summary_description: 'sun stick reapply portable',
    search_preview: 'sun stick',
    attributes: { concern_tags: ['uv_protection'], role_tags: ['portable'] },
  },
  {
    product_no: '105',
    product_name: 'Outdoor Sun Spray 100ml',
    category_ids: [93],
    price: 22900,
    summary_description: 'sun spray outdoor reapply',
    search_preview: 'sun spray',
    attributes: { concern_tags: ['uv_protection'], role_tags: ['outdoor'] },
  },
];

async function runQuery(query, extraArgs = {}) {
  return recommendationService.scoreAndFilterProducts(MOCK_PRODUCTS, { query, ...extraArgs }, 3);
}

function getMainForms(response) {
  return (response.main_recommendations || []).map((item) => item.form);
}

test('A. 기본 선크림 추천은 plain으로 처리되고 main은 cream/lotion만 유지된다', async () => {
  const res = await runQuery('선크림 추천해주세요');
  const forms = getMainForms(res);

  assert.equal(res.requested_category, 'sunscreen');
  assert.equal(res.applied_policy.requested_form, null);
  assert.deepStrictEqual(res.applied_policy.allowed_main_forms, ['cream', 'lotion']);
  assert.equal(forms.every((form) => ['cream', 'lotion'].includes(form)), true);
  assert.equal(forms.some((form) => ['serum', 'stick', 'spray'].includes(form)), false);
});

test('B. 건성 선크림 추천은 strict default가 아니며 기존 조건 정렬 흐름을 유지한다', async () => {
  const res = await runQuery('건성 선크림 추천');
  assert.equal(res.requested_category, 'sunscreen');
  assert.equal(res.applied_policy.requested_form, null);
  assert.deepStrictEqual(res.applied_policy.allowed_main_forms, ['cream', 'lotion']);
});

test('C. 수부지인데 선크림 밀려요는 조건 질의로 처리된다', async () => {
  const res = await runQuery('수부지인데 선크림 밀려요');
  assert.equal(res.requested_category, 'sunscreen');
  assert.equal(res.applied_policy.requested_form, null);
  assert.deepStrictEqual(res.applied_policy.allowed_main_forms, ['cream', 'lotion']);
});

test('D. 선세럼 추천은 explicit form strict가 우선 적용되고 serum만 main에 남는다', async () => {
  const res = await runQuery('선세럼 추천', { target_category_ids: [93] });
  const forms = getMainForms(res);

  assert.equal(res.requested_category, 'sunscreen');
  assert.equal(res.applied_policy.requested_form, 'serum');
  assert.deepStrictEqual(res.applied_policy.allowed_main_forms, ['serum']);
  assert.equal(forms.length >= 1, true);
  assert.equal(forms.every((form) => form === 'serum'), true);
});

test('E. 선스틱 추천은 explicit form strict로 stick만 main에 남는다', async () => {
  const res = await runQuery('선스틱 추천');
  const forms = getMainForms(res);

  assert.equal(res.requested_category, 'sunscreen');
  assert.equal(res.applied_policy.requested_form, 'stick');
  assert.deepStrictEqual(res.applied_policy.allowed_main_forms, ['stick']);
  assert.equal(forms.length >= 1, true);
  assert.equal(forms.every((form) => form === 'stick'), true);
});

test('F. 톤업 선크림 추천은 plain이 아니므로 default strict 대상이 아니다', async () => {
  const res = await runQuery('tone up sunscreen 추천');
  const forms = getMainForms(res);

  assert.equal(res.requested_category, 'sunscreen');
  assert.equal(res.applied_policy.requested_form, null);
  assert.deepStrictEqual(res.applied_policy.allowed_main_forms, ['cream', 'lotion']);
  // tone_up은 baseline concern이 아니므로 plain strict를 타지 않아 non-cream 후보가 main에 들어올 수 있어야 한다.
  assert.equal(forms.includes('serum') || forms.includes('stick') || forms.includes('spray'), true);
});
