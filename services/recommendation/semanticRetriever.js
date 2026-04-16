import { lower } from './shared.js';

const productEmbeddingCache = new Map();
const queryEmbeddingCache = new Map();

function hashText(input = '') {
  let hash = 2166136261;
  const str = String(input || '');
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16);
}

function normalizeVector(vector = []) {
  if (!Array.isArray(vector) || !vector.length) return [];
  const norm = Math.sqrt(vector.reduce((acc, v) => acc + v * v, 0));
  if (!Number.isFinite(norm) || norm <= 0) return [];
  return vector.map((v) => v / norm);
}

function dotProduct(a = [], b = []) {
  const n = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < n; i += 1) sum += a[i] * b[i];
  return sum;
}

function featureHints(product = {}) {
  const fv = product.feature_vector || {};
  const hints = [];

  if ((fv.lightweight_score || 0) >= 4) hints.push('가벼운 사용감');
  if ((fv.moisturizing_score || 0) >= 4) hints.push('촉촉한 보습감');
  if ((fv.toneup_score || 0) >= 3) hints.push('톤업/커버');
  if ((fv.soothing_score || 0) >= 3) hints.push('민감 피부/진정');
  if ((fv.reapply_fit || 0) >= 3) hints.push('덧바르기 편함');
  if ((fv.makeup_compat || 0) >= 3) hints.push('메이크업 궁합');
  if ((fv.irritation_risk || 0) >= 5) hints.push('자극 주의');
  if (product.form) hints.push(`제형:${product.form}`);
  if (product.category_key) hints.push(`카테고리:${product.category_key}`);

  return hints.join(', ');
}

function buildProductEmbeddingText(product = {}) {
  return [
    product.name || '',
    product.base_name || '',
    product.summary_description || '',
    product.search_preview || '',
    (product.attributes?.concern_tags || []).join(' '),
    (product.attributes?.texture_tags || []).join(' '),
    (product.derived_attributes?.concern_signals || []).join(' '),
    (product.derived_attributes?.texture_signals || []).join(' '),
    (product.derived_attributes?.finish_signals || []).join(' '),
    (product.derived_attributes?.use_case_signals || []).join(' '),
    featureHints(product),
  ]
    .filter(Boolean)
    .join(' | ')
    .slice(0, 2200);
}

function buildQueryEmbeddingText(intent = {}) {
  const parts = [
    intent.query || '',
    intent.requested_category ? `카테고리:${intent.requested_category}` : '',
    intent.requested_form ? `제형:${intent.requested_form}` : '',
    intent.skin_type ? `피부:${intent.skin_type}` : '',
    (intent.concern || []).length ? `고민:${(intent.concern || []).join(',')}` : '',
    (intent.situation || []).length ? `상황:${(intent.situation || []).join(',')}` : '',
    (intent.preference || []).length ? `선호:${(intent.preference || []).join(',')}` : '',
    (intent.fit_issue || []).length ? `불편:${(intent.fit_issue || []).join(',')}` : '',
    intent.negative_scope ? `부정범위:${intent.negative_scope}` : '',
  ];
  return parts.filter(Boolean).join(' | ').slice(0, 1200);
}

async function embedInputs(openai, model, inputs = []) {
  if (!inputs.length) return [];
  const res = await openai.embeddings.create({
    model,
    input: inputs,
  });
  const list = Array.isArray(res?.data) ? res.data : [];
  return list.map((row) => normalizeVector(row?.embedding || []));
}

async function ensureProductEmbeddings(products = [], openai, model, batchSize = 32) {
  const missing = [];
  for (const p of products) {
    const text = buildProductEmbeddingText(p);
    const key = `${model}:${p.id}:${hashText(text)}`;
    p._semantic_embedding_key = key;
    p._semantic_text = text;
    if (!productEmbeddingCache.has(key)) {
      missing.push({ key, text });
    }
  }

  for (let i = 0; i < missing.length; i += batchSize) {
    const chunk = missing.slice(i, i + batchSize);
    const vectors = await embedInputs(
      openai,
      model,
      chunk.map((x) => x.text)
    );
    chunk.forEach((item, idx) => {
      productEmbeddingCache.set(item.key, vectors[idx] || []);
    });
  }
}

async function getQueryEmbedding(intent, openai, model) {
  const text = buildQueryEmbeddingText(intent);
  const key = `${model}:${hashText(text)}`;
  if (queryEmbeddingCache.has(key)) return queryEmbeddingCache.get(key);
  const [vec] = await embedInputs(openai, model, [text]);
  queryEmbeddingCache.set(key, vec || []);
  return vec || [];
}

export async function applySemanticSignals(candidates = [], intent = {}, options = {}) {
  const {
    openai = null,
    enabled = true,
    model = 'text-embedding-3-small',
    minCandidateCount = 3,
    maxPool = 40,
    semanticWeight = 1.1,
    batchSize = 32,
    logger = null,
  } = options;

  if (!enabled || !openai || !Array.isArray(candidates) || candidates.length < minCandidateCount) {
    return candidates.map((p) => ({ ...p, _semantic_score: 0, _semantic_weight: 0 }));
  }

  const query = String(intent.query || '').trim();
  if (query.length < 2) {
    return candidates.map((p) => ({ ...p, _semantic_score: 0, _semantic_weight: 0 }));
  }

  try {
    await ensureProductEmbeddings(candidates, openai, model, batchSize);
    const queryVector = await getQueryEmbedding(intent, openai, model);
    if (!queryVector.length) {
      return candidates.map((p) => ({ ...p, _semantic_score: 0, _semantic_weight: 0 }));
    }

    const scored = candidates
      .map((p) => {
        const vector = productEmbeddingCache.get(p._semantic_embedding_key) || [];
        const cosine = vector.length ? dotProduct(queryVector, vector) : 0;
        const semanticScore = Number((((cosine + 1) / 2) * 100).toFixed(3));
        return { ...p, _semantic_score: semanticScore, _semantic_weight: semanticWeight };
      })
      .sort((a, b) => (b._semantic_score || 0) - (a._semantic_score || 0));

    const poolSize = Math.max(Math.min(maxPool, scored.length), minCandidateCount);
    const pruned = scored.slice(0, poolSize);
    logger?.info?.(
      `[Semantic] model=${model} candidates=${candidates.length} pool=${pruned.length} top_score=${pruned[0]?._semantic_score ?? 0}`
    );
    return pruned;
  } catch (error) {
    logger?.warn?.(`[Semantic] skipped: ${error.message}`);
    return candidates.map((p) => ({ ...p, _semantic_score: 0, _semantic_weight: 0 }));
  }
}
