const counters = {
  total_requests: 0,
  category_lock_violation_count: 0,
  form_lock_violation_count: 0,
  fallback_count: 0,
  no_result_count: 0,
};

function ratio(numerator, denominator) {
  if (!denominator) return 0;
  return Number((numerator / denominator).toFixed(4));
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

export function trackFallback() {
  counters.fallback_count += 1;
}

export function trackNoResult() {
  counters.no_result_count += 1;
}

export function getRecommendationMetrics() {
  const total = counters.total_requests;
  return {
    ...counters,
    fallback_rate: ratio(counters.fallback_count, total),
    no_result_rate: ratio(counters.no_result_count, total),
  };
}

export function resetRecommendationMetrics() {
  counters.total_requests = 0;
  counters.category_lock_violation_count = 0;
  counters.form_lock_violation_count = 0;
  counters.fallback_count = 0;
  counters.no_result_count = 0;
}
