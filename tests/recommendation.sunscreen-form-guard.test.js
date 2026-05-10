import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUserIntent } from '../services/recommendation/intentParser.js';
import { normalizeIntentWithLLM } from '../services/recommendation/intentNormalizer.js';

const TAXONOMY = {
  categories: {
    sunscreen: ['선크림', '썬크림', '선스틱', '썬스틱', 'sunscreen', 'sun'],
  },
  forms: {
    cream: ['크림', 'cream', 'sunscreen'],
    stick: ['선스틱', '썬스틱', 'stick', 'sun stick'],
    spray: ['선스프레이', 'spray'],
    serum: ['선세럼', 'serum'],
    lotion: ['로션', 'lotion'],
  },
  skinTypes: {
    dry: ['건성', 'dry'],
  },
  concerns: {
    hydration: ['수분', '보습', '건조'],
    uv_protection: ['자외선', 'uv'],
  },
  situations: {},
  preferences: {},
  noveltyKeywords: [],
  popularityKeywords: [],
};

test('"선크림 추천"은 form=cream으로 잡히면 안 된다', () => {
  const parsed = parseUserIntent({ query: '선크림 추천' }, TAXONOMY);
  assert.equal(parsed.requested_category, 'sunscreen');
  assert.equal(parsed.requested_form, null);
  assert.equal(parsed.explicit_form_request, false);
});

test('"건성 선크림 추천"은 form=cream으로 잡히면 안 된다', () => {
  const parsed = parseUserIntent({ query: '건성 선크림 추천' }, TAXONOMY);
  assert.equal(parsed.requested_category, 'sunscreen');
  assert.equal(parsed.requested_form, null);
  assert.equal(parsed.explicit_form_request, false);
});

test('"아쿠아티카 선크림"은 keyword constraint만 잡고 form=cream은 금지', () => {
  const parsed = parseUserIntent({ query: '아쿠아티카 선크림' }, TAXONOMY);
  assert.equal(parsed.requested_category, 'sunscreen');
  assert.equal(parsed.requested_form, null);
  assert.equal(parsed.product_keyword_constraints.includes('아쿠아티카'), true);
});

test('"크림 타입 선크림 추천"은 form=cream 허용', () => {
  const parsed = parseUserIntent({ query: '크림 타입 선크림 추천' }, TAXONOMY);
  assert.equal(parsed.requested_category, 'sunscreen');
  assert.equal(parsed.requested_form, 'cream');
  assert.equal(parsed.explicit_form_request, true);
});

test('"선스틱 추천"은 기존처럼 form=stick 유지', () => {
  const parsed = parseUserIntent({ query: '선스틱 추천' }, TAXONOMY);
  assert.equal(parsed.requested_category, 'sunscreen');
  assert.equal(parsed.requested_form, 'stick');
  assert.equal(parsed.explicit_form_request, true);
});

test('LLM이 sunscreen+cream을 반환해도 일반 선크림 질의면 cream form을 제거한다', async () => {
  const openai = {
    responses: {
      create: async () => ({
        output_text: JSON.stringify({
          requested_category: 'sunscreen',
          requested_form: 'cream',
          sort_intent: 'popular',
          concern: [],
          situation: [],
          preference: [],
          fit_issue: [],
        }),
      }),
    },
  };
  const ruleParsed = parseUserIntent({ query: '선크림 추천' }, TAXONOMY);
  const result = await normalizeIntentWithLLM(openai, { query: '선크림 추천' }, ruleParsed, 'mock-model');
  assert.equal(result.intent.requested_form, null);
});
