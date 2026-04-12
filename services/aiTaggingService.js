import { logger } from '../utils/logger.js';

const WHITELIST = {
  category_tags: ['앰플', '세럼', '크림', '토너', '선크림', '선세럼', '선스틱', '비비', '밤', '마스크', '패드', '클렌징', '로션'],
  line_tags: ['아쿠아티카', '시카', '패리어', '레이저', '더마'],
  concern_tags: ['진정', '보습', '장벽', '재생', '민감', '잡티', '탄력', '피부결', '유수분', '수분', '자외선', '모공', '주름', '각질'],
  texture_tags: ['가벼운', '촉촉한', '워터리', '리치한', '보송한', '실키한', '쿠션'],
};

function extractTagsByRule(name = '', desc = '', categoryNos = []) {
  const combined = `${name} ${desc}`.toLowerCase();

  const tags = {
    category_tags: WHITELIST.category_tags.filter((t) => combined.includes(t.toLowerCase())),
    line_tags: WHITELIST.line_tags.filter((t) => combined.includes(t.toLowerCase())),
    concern_tags: WHITELIST.concern_tags.filter((t) => combined.includes(t.toLowerCase())),
    texture_tags: WHITELIST.texture_tags.filter((t) => combined.includes(t.toLowerCase())),
  };

  if (combined.includes('스틱') && (name.includes('스틱') || name.toLowerCase().includes('stick'))) {
    if (!tags.category_tags.includes('선스틱')) tags.category_tags.push('선스틱');
    if (!tags.concern_tags.includes('간편함')) tags.concern_tags.push('간편함');
  }

  if (tags.category_tags.includes('선세럼')) {
    const isSunCategory = categoryNos.includes(93);
    const isSunName =
      name.toLowerCase().includes('선세럼') ||
      name.toLowerCase().includes('선크림') ||
      name.toLowerCase().includes('sun');

    if (!isSunCategory && !isSunName) {
      tags.category_tags = tags.category_tags.filter((t) => t !== '선세럼');
    }
  }

  return tags;
}

function tagAllProducts(products) {
  if (!Array.isArray(products) || products.length === 0) return [];

  logger.info(`[Tagging] ${products.length} products rule-tagging...`);

  return products.map((product) => {
    const name = product.product_name || '';
    const desc = product.summary_description || product.simple_description || '';
    const categoryNos = Array.isArray(product.categories)
      ? product.categories.map((c) => Number(c.category_no))
      : [];

    const tags = extractTagsByRule(name, desc, categoryNos);
    return {
      product_no: product.product_no,
      ...tags,
      all_tags: [
        ...new Set([
          ...tags.category_tags,
          ...tags.line_tags,
          ...tags.concern_tags,
          ...tags.texture_tags,
        ]),
      ].filter((t) => typeof t === 'string' && t.length > 0),
    };
  });
}

export const aiTaggingService = {
  WHITELIST,
  extractTagsByRule,
  tagAllProducts,
};
