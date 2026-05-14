import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUserIntent } from '../services/recommendation/intentParser.js';

const TAXONOMY = {
  categories: {
    sunscreen: ['sunscreen', 'sun'],
  },
  forms: {
    cream: ['cream'],
    stick: ['stick'],
    spray: ['spray'],
    serum: ['serum'],
  },
  skinTypes: {},
  concerns: {
    hydration: ['hydration'],
    soothing: ['soothing'],
    uv_protection: ['uv'],
  },
  situations: {},
  preferences: {},
  noveltyKeywords: [],
  popularityKeywords: [],
  productKeywordDictionary: [
    { canonical: '\uC544\uCFE0\uC544\uD2F0\uCE74', variants: ['\uC544\uCFE0\uC544\uD2F0\uCE74', 'aquatica'] },
  ],
};

test('extracts product_keyword_constraints from line keyword query', () => {
  const parsed = parseUserIntent({ query: 'aquatica sunscreen 추천' }, TAXONOMY);
  assert.equal(Array.isArray(parsed.product_keyword_constraints), true);
  assert.equal(parsed.product_keyword_constraints.includes('\uC544\uCFE0\uC544\uD2F0\uCE74'), true);
});

test('supports explicit form + product keyword constraints together', () => {
  const parsed = parseUserIntent({ query: 'aquatica stick sunscreen' }, TAXONOMY);
  assert.equal(parsed.requested_form, 'stick');
  assert.equal(parsed.explicit_form_request, true);
  assert.equal(parsed.product_keyword_constraints.includes('\uC544\uCFE0\uC544\uD2F0\uCE74'), true);
});

test('falls back cleanly when no known product keyword is present', () => {
  const parsed = parseUserIntent({ query: 'unknown sunscreen' }, TAXONOMY);
  assert.deepStrictEqual(parsed.product_keyword_constraints, []);
});
