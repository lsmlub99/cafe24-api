import { findFirstAliasKey, lower, parseDateMs, parsePrice, toBaseName, isPromoName } from './shared.js';

export function extractCategoryIds(raw = {}) {
  if (Array.isArray(raw.categories)) {
    return raw.categories.map((c) => Number(c?.category_no)).filter((n) => Number.isFinite(n));
  }
  if (Array.isArray(raw.category_ids)) {
    return raw.category_ids.map((n) => Number(n)).filter((n) => Number.isFinite(n));
  }
  return [];
}

export function detectProductForm(nameText = '', fullText = '', taxonomy) {
  const source = `${nameText} ${fullText}`;
  return findFirstAliasKey(source, taxonomy.forms) || 'other';
}

export function normalizeCafe24Product(raw = {}, taxonomy) {
  const name = raw.product_name || raw.name || '';
  const categoryIds = extractCategoryIds(raw);
  const priceValue = parsePrice(raw.price || raw.retail_price || 0);

  let image = raw.list_image || raw.detail_image || raw.tiny_image || raw.image || '';
  if (image.startsWith('//')) image = `https:${image}`;
  else if (image.startsWith('/')) image = `https://cellfusionc.co.kr${image}`;
  image = image.replace('http:', 'https:');

  const text = lower(
    `${name} ${raw.summary_description || ''} ${raw.simple_description || ''} ${raw.search_preview || ''} ${
      raw.search_features || ''
    }`
  );

  const concernTags = Array.isArray(raw.attributes?.concern_tags) ? raw.attributes.concern_tags : [];
  const lineTags = Array.isArray(raw.attributes?.line_tags) ? raw.attributes.line_tags : [];
  const textureTags = Array.isArray(raw.attributes?.texture_tags) ? raw.attributes.texture_tags : [];

  return {
    id: String(raw.product_no || raw.product_id || raw.id || ''),
    name,
    base_name: toBaseName(name),
    form: detectProductForm(name, text, taxonomy),
    category_ids: categoryIds,
    summary_description: raw.summary_description || raw.simple_description || '',
    text,
    search_preview: raw.search_preview || '',
    attributes: { concern_tags: concernTags, line_tags: lineTags, texture_tags: textureTags },
    is_promo: isPromoName(name),
    price_value: priceValue,
    price: priceValue.toLocaleString(),
    created_at_ms: Math.max(parseDateMs(raw.release_date), parseDateMs(raw.created_date), parseDateMs(raw.updated_date)),
    review_count: Number(raw.review_count || raw.review_cnt || 0) || 0,
    rating: Number(raw.review_avg || raw.rating || 0) || 0,
    sales_count: Number(raw.sales_count || raw.order_count || 0) || 0,
    image,
  };
}

