import { includesAny, lower } from './shared.js';

const TOKEN = {
  lightweight: ['\uAC00\uBCFC', '\uC0B0\uB73B', '\uBCF4\uC1A1', 'lightweight', 'fresh'],
  moisturizing: ['\uCD09\uCD09', '\uBCF4\uC2B5', '\uC218\uBD84', 'moist', 'hydration'],
  toneup: ['\uD1A4\uC5C5', '\uC7A1\uD2F0', '\uCEE4\uBC84', '\uD1A4 \uBCF4\uC815', 'tone', 'cover'],
  irritationRisk: ['\uD5A5\uB8CC', '\uC54C\uCF54\uC62C', 'fragrance', 'parfum', 'alcohol'],
  soothing: ['\uC9C4\uC815', '\uC2DC\uCE74', '\uCE74\uBC0D', '\uBBFC\uAC10', 'calming', 'cica'],
  reapply: ['\uC7AC\uB3C4\uD3EC', '\uB367\uBC14\uB974', '\uD734\uB300', 'reapply', 'portable'],
  makeupCompat: ['\uBA54\uC774\uD06C\uC5C5', '\uBC00\uB9BC \uC801', '\uAD81\uD569', 'makeup', 'primer'],
};

function scoreFeature(source, words, weight = 1) {
  const hit = words.reduce((acc, w) => (source.includes(lower(w)) ? acc + 1 : acc), 0);
  return hit * weight;
}

export function extractFeatureVector(product = {}) {
  const source = lower(
    [
      product.name || '',
      product.text || '',
      product.summary_description || '',
      product.search_preview || '',
      (product.attributes?.concern_tags || []).join(' '),
      (product.attributes?.texture_tags || []).join(' '),
    ].join(' ')
  );

  const lightweightScore = scoreFeature(source, TOKEN.lightweight, 2);
  const moisturizingScore = scoreFeature(source, TOKEN.moisturizing, 2);
  const toneupScore = scoreFeature(source, TOKEN.toneup, 2);
  const irritationRiskScore = scoreFeature(source, TOKEN.irritationRisk, 2);
  const soothingScore = scoreFeature(source, TOKEN.soothing, 2);
  const reapplyFitScore = scoreFeature(source, TOKEN.reapply, 2);
  const makeupCompatScore = scoreFeature(source, TOKEN.makeupCompat, 2);

  const finish =
    toneupScore >= 2
      ? 'tone_up'
      : lightweightScore > moisturizingScore
      ? 'light'
      : moisturizingScore > 0
      ? 'moist'
      : 'neutral';
  const texture = lightweightScore >= moisturizingScore ? 'lightweight' : 'moisturizing';

  return {
    form: product.form || 'other',
    finish,
    texture,
    irritation_risk: Math.min(10, irritationRiskScore),
    soothing_score: Math.min(10, soothingScore),
    makeup_compat: Math.min(10, makeupCompatScore),
    reapply_fit: Math.min(10, reapplyFitScore),
    lightweight_score: Math.min(10, lightweightScore),
    moisturizing_score: Math.min(10, moisturizingScore),
    toneup_score: Math.min(10, toneupScore),
    has_reactive_warning: includesAny(source, ['\uD5A5\uB8CC', '\uC54C\uCF54\uC62C', 'fragrance', 'parfum']),
  };
}

