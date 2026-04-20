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

  if ((fv.lightweight_score || 0) >= 4) hints.push('lightweight');
  if ((fv.moisturizing_score || 0) >= 4) hints.push('moisturizing');
  if ((fv.toneup_score || 0) >= 3) hints.push('tone_up');
  if ((fv.soothing_score || 0) >= 3) hints.push('soothing');
  if ((fv.reapply_fit || 0) >= 3) hints.push('reapply');
  if ((fv.makeup_compat || 0) >= 3) hints.push('makeup_compatible');
  if ((fv.irritation_risk || 0) >= 5) hints.push('irritation_risk');
  if (product.form) hints.push(`form:${product.form}`);
  if (product.category_key) hints.push(`category:${product.category_key}`);

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

function buildComposedQueryTokens(intent = {}) {
  const tokens = [];
  if (intent.requested_category) tokens.push(intent.requested_category);
  if (intent.requested_form) tokens.push(intent.requested_form);
  if (intent.skin_type) tokens.push(intent.skin_type);
  for (const c of intent.concern || []) if (c && c !== 'unknown') tokens.push(c);
  for (const f of intent.fit_issue || []) if (f && f !== 'unknown') tokens.push(f);
  for (const s of intent.situation || []) if (s && s !== 'unknown') tokens.push(s);
  for (const p of intent.preference || []) if (p && p !== 'unknown') tokens.push(p);

  const unique = [...new Set(tokens)];
  if (unique.length >= 3) return unique;

  const coldStartDefaults = getColdStartDefaultTokens(intent);
  return [...new Set([...unique, ...coldStartDefaults])];
}

function getColdStartDefaultTokens(intent = {}) {
  const defaults = ['daily'];
  const category = String(intent.requested_category || '').trim();

  if (category === 'sunscreen') {
    defaults.push('uv_protection', 'lightweight');
  } else if (category === 'toner') {
    defaults.push('hydration', 'soothing');
  } else if (category === 'serum') {
    defaults.push('targeted_care', 'lightweight');
  } else if (category === 'cream') {
    defaults.push('hydration', 'moisturizing');
  } else if (category === 'cushion' || category === 'bb') {
    defaults.push('coverage', 'makeup_before');
  } else {
    defaults.push('skincare', 'recommended');
  }

  if (intent.sort_intent === 'popular') defaults.push('popular');
  if (intent.novelty_request) defaults.push('new_arrival');
  if (intent.skin_type) defaults.push(intent.skin_type);

  return defaults;
}

function resolveQueryText(intent = {}) {
  const original = String(intent.query || '').trim();
  if (original.length >= 2) {
    return {
      text: original,
      source: 'original',
      token_count: original.split(/\s+/).filter(Boolean).length,
      skip_reason: null,
    };
  }

  const composedTokens = buildComposedQueryTokens(intent);
  if (composedTokens.length < 3) {
    return {
      text: '',
      source: 'composed',
      token_count: composedTokens.length,
      skip_reason: 'empty_query',
    };
  }

  return {
    text: composedTokens.join(' '),
    source: 'composed',
    token_count: composedTokens.length,
    skip_reason: null,
  };
}

function buildQueryEmbeddingText(intent = {}, queryText = '') {
  const parts = [
    queryText || '',
    intent.requested_category ? `category:${intent.requested_category}` : '',
    intent.requested_form ? `form:${intent.requested_form}` : '',
    intent.skin_type ? `skin:${intent.skin_type}` : '',
    (intent.concern || []).length ? `concern:${(intent.concern || []).join(',')}` : '',
    (intent.situation || []).length ? `situation:${(intent.situation || []).join(',')}` : '',
    (intent.preference || []).length ? `preference:${(intent.preference || []).join(',')}` : '',
    (intent.fit_issue || []).length ? `fit_issue:${(intent.fit_issue || []).join(',')}` : '',
    intent.negative_scope ? `negative_scope:${intent.negative_scope}` : '',
  ];
  return parts.filter(Boolean).join(' | ').slice(0, 1200);
}

async function embedInputs(openai, model, inputs = []) {
  if (!inputs.length) return [];
  const res = await openai.embeddings.create({ model, input: inputs });
  const list = Array.isArray(res?.data) ? res.data : [];
  return list.map((row) => normalizeVector(row?.embedding || []));
}

async function ensureProductEmbeddings(products = [], openai, model, batchSize = 32) {
  const missing = [];
  for (const p of products) {
    const text = buildProductEmbeddingText(p);
    const key = `${model}:${p.id}:${hashText(text)}`;
    p._semantic_embedding_key = key;
    if (!productEmbeddingCache.has(key)) missing.push({ key, text });
  }

  for (let i = 0; i < missing.length; i += batchSize) {
    const chunk = missing.slice(i, i + batchSize);
    const vectors = await embedInputs(
      openai,
      model,
      chunk.map((x) => x.text)
    );
    chunk.forEach((item, idx) => productEmbeddingCache.set(item.key, vectors[idx] || []));
  }
}

async function getQueryEmbedding(intent, openai, model, queryText) {
  const text = buildQueryEmbeddingText(intent, queryText);
  const key = `${model}:${hashText(text)}`;
  if (queryEmbeddingCache.has(key)) return queryEmbeddingCache.get(key);
  const [vec] = await embedInputs(openai, model, [text]);
  queryEmbeddingCache.set(key, vec || []);
  return vec || [];
}

function buildDiagnostics(base = {}, overrides = {}) {
  return {
    semantic_enabled: true,
    embedding_model: base.embedding_model || null,
    semantic_candidates_count: Number(base.semantic_candidates_count || 0),
    semantic_nonzero_count: Number(base.semantic_nonzero_count || 0),
    semantic_nonzero_ratio: Number(base.semantic_nonzero_ratio || 0),
    semantic_skip_reason: base.semantic_skip_reason ?? null,
    semantic_query_source: base.semantic_query_source || 'original',
    semantic_query_token_count: Number(base.semantic_query_token_count || 0),
    ...overrides,
  };
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

  const emptyScores = (list = []) => list.map((p) => ({ ...p, _semantic_score: 0, _semantic_weight: 0 }));
  const queryInfo = resolveQueryText(intent);

  if (!enabled) {
    return {
      candidates: emptyScores(candidates),
      diagnostics: buildDiagnostics(
        {
          embedding_model: model,
          semantic_candidates_count: Array.isArray(candidates) ? candidates.length : 0,
          semantic_skip_reason: 'semantic_disabled',
          semantic_query_source: queryInfo.source,
          semantic_query_token_count: queryInfo.token_count,
        },
        { semantic_enabled: false }
      ),
    };
  }
  if (!Array.isArray(candidates) || candidates.length < minCandidateCount) {
    return {
      candidates: emptyScores(candidates),
      diagnostics: buildDiagnostics({
        embedding_model: model,
        semantic_candidates_count: Array.isArray(candidates) ? candidates.length : 0,
        semantic_skip_reason: 'too_few_candidates',
        semantic_query_source: queryInfo.source,
        semantic_query_token_count: queryInfo.token_count,
      }),
    };
  }
  if (!queryInfo.text) {
    return {
      candidates: emptyScores(candidates),
      diagnostics: buildDiagnostics({
        embedding_model: model,
        semantic_candidates_count: candidates.length,
        semantic_skip_reason: queryInfo.skip_reason || 'empty_query',
        semantic_query_source: queryInfo.source,
        semantic_query_token_count: queryInfo.token_count,
      }),
    };
  }
  if (!openai) {
    return {
      candidates: emptyScores(candidates),
      diagnostics: buildDiagnostics({
        embedding_model: model,
        semantic_candidates_count: Array.isArray(candidates) ? candidates.length : 0,
        semantic_skip_reason: 'openai_unavailable',
        semantic_query_source: queryInfo.source,
        semantic_query_token_count: queryInfo.token_count,
      }),
    };
  }

  try {
    await ensureProductEmbeddings(candidates, openai, model, batchSize);
    const queryVector = await getQueryEmbedding(intent, openai, model, queryInfo.text);
    if (!queryVector.length) {
      return {
        candidates: emptyScores(candidates),
        diagnostics: buildDiagnostics({
          embedding_model: model,
          semantic_candidates_count: candidates.length,
          semantic_skip_reason: 'query_embedding_empty',
          semantic_query_source: queryInfo.source,
          semantic_query_token_count: queryInfo.token_count,
        }),
      };
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
    const nonzeroCount = pruned.filter((p) => Number(p._semantic_score || 0) > 0).length;
    const ratio = pruned.length ? Number((nonzeroCount / pruned.length).toFixed(4)) : 0;
    const skipReason = nonzeroCount > 0 ? null : 'all_zero_scores';

    logger?.info?.(
      `[Semantic] model=${model} query_source=${queryInfo.source} query_tokens=${queryInfo.token_count} candidates=${candidates.length} pool=${pruned.length} nonzero=${nonzeroCount} top_score=${pruned[0]?._semantic_score ?? 0}`
    );
    return {
      candidates: pruned,
      diagnostics: buildDiagnostics({
        embedding_model: model,
        semantic_candidates_count: pruned.length,
        semantic_nonzero_count: nonzeroCount,
        semantic_nonzero_ratio: ratio,
        semantic_skip_reason: skipReason,
        semantic_query_source: queryInfo.source,
        semantic_query_token_count: queryInfo.token_count,
      }),
    };
  } catch (error) {
    logger?.warn?.(`[Semantic] skipped: ${error.message}`);
    return {
      candidates: emptyScores(candidates),
      diagnostics: buildDiagnostics({
        embedding_model: model,
        semantic_candidates_count: Array.isArray(candidates) ? candidates.length : 0,
        semantic_skip_reason: 'semantic_error',
        semantic_query_source: queryInfo.source,
        semantic_query_token_count: queryInfo.token_count,
      }),
    };
  }
}
