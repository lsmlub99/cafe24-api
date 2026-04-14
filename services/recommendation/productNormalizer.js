import { lower, parseDateMs, parsePrice, toBaseName, isPromoName } from './shared.js';

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
  const nameSource = lower(nameText);
  const textSource = lower(fullText);

  // Form-specific terms should win over broad category words.
  const priority = ['spray', 'stick', 'cushion', 'serum', 'lotion', 'cream', 'toner', 'mist'];
  for (const form of priority) {
    const aliases = taxonomy.forms?.[form] || [];
    if (aliases.some((a) => a && nameSource.includes(lower(a)))) return form;
  }

  // Fallback on body text with conservative matching to reduce over-classification.
  for (const form of priority) {
    const aliases = taxonomy.forms?.[form] || [];
    const longAliases = aliases.filter((a) => String(a || '').length >= 2);
    if (longAliases.some((a) => a && textSource.includes(lower(a)))) return form;
  }

  return 'other';
}

function pickSignals(source = '', groups = {}) {
  const out = [];
  for (const [key, keywords] of Object.entries(groups || {})) {
    if (!Array.isArray(keywords) || !keywords.length) continue;
    if (keywords.some((kw) => kw && source.includes(lower(kw)))) out.push(key);
  }
  return out;
}

export function extractProductAttributes(raw = {}, name = '', text = '') {
  const signalSource = lower(
    [
      name,
      raw.summary_description || '',
      raw.simple_description || '',
      raw.search_preview || '',
      raw.search_features || '',
      (raw.attributes?.concern_tags || []).join(' '),
      (raw.attributes?.texture_tags || []).join(' '),
      (raw.attributes?.line_tags || []).join(' '),
    ].join(' ')
  );

  const textureSignals = pickSignals(signalSource, {
    lightweight: ['산뜻', '가벼', '보송', '라이트', 'light'],
    moisturizing: ['촉촉', '수분', '보습', 'moist', 'hydration'],
    low_oily: ['유분 적', '번들 적', '보송', '매트', 'sebum'],
  });

  const finishSignals = pickSignals(signalSource, {
    tone_up: ['톤업', '톤 보정', '잡티', '커버', 'tone', 'cover'],
    low_white_cast: ['백탁 적', '백탁 없음', 'white cast', '무백탁'],
    makeup_friendly: ['메이크업', '밀림 적', '궁합', '베이스'],
  });

  const useCaseSignals = pickSignals(signalSource, {
    outdoor: ['야외', '러닝', '운동', '골프', '등산', '재도포'],
    daily: ['데일리', '매일', 'daily'],
    reapply_friendly: ['재도포', '덧바름', '휴대', 'portable'],
  });

  const lineTags = Array.isArray(raw.attributes?.line_tags) ? raw.attributes.line_tags : [];
  const nameLineGuess = String(name || '')
    .replace(/\[[^\]]*]/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .join(' ');
  const lineKey = lineTags[0] ? lower(String(lineTags[0]).trim()) : lower(nameLineGuess);

  const concernSignals = pickSignals(signalSource, {
    hydration: ['보습', '수분', '촉촉', '아쿠아', 'hydra', 'moist'],
    soothing: ['진정', '카밍', '시카', '민감', '패리어', 'calming', 'cica'],
    sebum_control: ['유분', '피지', '번들', '보송', '모공', '포어', 'pore', 'sebum'],
    tone_up: ['톤업', '잡티', '토닝', '커버', 'tone', 'cover'],
    uv_protection: ['자외선', 'uv', 'sun', 'spf', 'pa++++'],
  });

  // Lightweight inference from form itself.
  if (signalSource.includes('스프레이') || signalSource.includes('spray') || signalSource.includes('미스트')) {
    useCaseSignals.push('reapply_friendly');
    textureSignals.push('lightweight');
  }
  if (signalSource.includes('스틱') || signalSource.includes('stick')) {
    useCaseSignals.push('reapply_friendly');
  }

  return {
    texture_signals: textureSignals,
    finish_signals: finishSignals,
    use_case_signals: useCaseSignals,
    concern_signals: concernSignals,
    line_key: lineKey || '',
  };
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
  const derivedAttrs = extractProductAttributes(raw, name, text);

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
    derived_attributes: derivedAttrs,
    line_key: derivedAttrs.line_key || '',
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
