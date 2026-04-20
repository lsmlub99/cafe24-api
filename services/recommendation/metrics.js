const ROLLING_WINDOW = 100;
const FALLBACK_SAMPLE_LIMIT = 20;

const counters = {
  total_requests: 0,
  category_lock_violation_count: 0,
  form_lock_violation_count: 0,
  fallback_count: 0,
  no_result_count: 0,
  reason_fallback_count: 0,
  explanation_mismatch_count: 0,
  repeat_penalty_hit_count: 0,
  repeat_penalty_total: 0,
  semantic_null_invalid_count: 0,
};

const rolling = {
  fallback_flags: [],
  mismatch_flags: [],
};

const fallbackSampleMap = new Map();

function ratio(numerator, denominator) {
  if (!denominator) return 0;
  return Number((numerator / denominator).toFixed(4));
}

function pushRollingFlag(arr, value) {
  arr.push(value ? 1 : 0);
  if (arr.length > ROLLING_WINDOW) arr.shift();
}

function rollingRate(arr) {
  if (!arr.length) return 0;
  const sum = arr.reduce((acc, x) => acc + x, 0);
  return ratio(sum, arr.length);
}

function getFallbackSampleKey(sample = {}) {
  return [
    sample.query_hash || 'na',
    sample.requested_category || 'na',
    sample.requested_form || 'na',
    sample.fallback_step || 'na',
    sample.reason_code || 'na',
  ].join('|');
}

function trackFallbackSample(sample = {}) {
  const key = getFallbackSampleKey(sample);
  const nowIso = new Date().toISOString();
  const prev = fallbackSampleMap.get(key);
  if (prev) {
    fallbackSampleMap.set(key, {
      ...prev,
      count: prev.count + 1,
      timestamp: sample.timestamp || nowIso,
      fit_issue: Array.isArray(sample.fit_issue) ? sample.fit_issue : prev.fit_issue || [],
      negative_scope: sample.negative_scope || prev.negative_scope || null,
      reason_code: sample.reason_code || prev.reason_code || null,
      requested_category: sample.requested_category || prev.requested_category || null,
      requested_form: sample.requested_form || prev.requested_form || null,
      fallback_step: sample.fallback_step || prev.fallback_step || null,
      query_hash: sample.query_hash || prev.query_hash || null,
    });
    return;
  }
  fallbackSampleMap.set(key, {
    timestamp: sample.timestamp || nowIso,
    requested_category: sample.requested_category || null,
    requested_form: sample.requested_form || null,
    fit_issue: Array.isArray(sample.fit_issue) ? sample.fit_issue : [],
    negative_scope: sample.negative_scope || null,
    fallback_step: sample.fallback_step || null,
    reason_code: sample.reason_code || null,
    query_hash: sample.query_hash || null,
    count: 1,
  });
}

function getTopFallbackSamples(limit = FALLBACK_SAMPLE_LIMIT) {
  return [...fallbackSampleMap.values()]
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return String(b.timestamp).localeCompare(String(a.timestamp));
    })
    .slice(0, Math.max(1, limit))
    .map((x) => ({
      timestamp: x.timestamp,
      requested_category: x.requested_category,
      requested_form: x.requested_form,
      fit_issue: x.fit_issue || [],
      negative_scope: x.negative_scope,
      fallback_step: x.fallback_step,
      reason_code: x.reason_code,
      query_hash: x.query_hash,
      count: x.count,
    }));
}

export function trackRequest() {
  counters.total_requests += 1;
}

export function trackCategoryLockViolation() {
  counters.category_lock_violation_count += 1;
}

export function trackFormLockViolation() {
  counters.form_lock_violation_count += 1;
}

export function trackFallback(sample = null) {
  counters.fallback_count += 1;
  pushRollingFlag(rolling.fallback_flags, true);
  if (sample && typeof sample === 'object') trackFallbackSample(sample);
}

export function trackNoFallbackForRequest() {
  pushRollingFlag(rolling.fallback_flags, false);
}

export function trackNoResult() {
  counters.no_result_count += 1;
}

export function trackReasonFallback() {
  counters.reason_fallback_count += 1;
}

export function trackExplanationMismatch() {
  counters.explanation_mismatch_count += 1;
  pushRollingFlag(rolling.mismatch_flags, true);
}

export function trackNoExplanationMismatchForRequest() {
  pushRollingFlag(rolling.mismatch_flags, false);
}

export function trackRepeatPenalty(penaltyValue = 0) {
  const value = Number(penaltyValue || 0);
  if (!(value > 0)) return;
  counters.repeat_penalty_hit_count += 1;
  counters.repeat_penalty_total += value;
}

export function trackSemanticNullInvalid() {
  counters.semantic_null_invalid_count += 1;
}

export function getRecommendationMetrics() {
  const total = counters.total_requests;
  return {
    ...counters,
    fallback_rate: ratio(counters.fallback_count, total),
    fallback_rate_total: ratio(counters.fallback_count, total),
    fallback_rate_rolling_100: rollingRate(rolling.fallback_flags),
    no_result_rate: ratio(counters.no_result_count, total),
    mismatch_rate_rolling_100: rollingRate(rolling.mismatch_flags),
    fallback_samples_top: getTopFallbackSamples(FALLBACK_SAMPLE_LIMIT),
  };
}

export function resetRecommendationMetrics() {
  counters.total_requests = 0;
  counters.category_lock_violation_count = 0;
  counters.form_lock_violation_count = 0;
  counters.fallback_count = 0;
  counters.no_result_count = 0;
  counters.reason_fallback_count = 0;
  counters.explanation_mismatch_count = 0;
  counters.repeat_penalty_hit_count = 0;
  counters.repeat_penalty_total = 0;
  counters.semantic_null_invalid_count = 0;
  rolling.fallback_flags = [];
  rolling.mismatch_flags = [];
  fallbackSampleMap.clear();
}
