const SESSION_TTL_MS = 1000 * 60 * 60 * 24; // 24h
const MAX_SESSIONS = 500;

const sessionStore = new Map();

function now() {
  return Date.now();
}

function toKey(sessionKey) {
  const key = String(sessionKey || '').trim();
  return key || 'global';
}

function pruneExpired() {
  const t = now();
  for (const [key, value] of sessionStore.entries()) {
    if (!value?.updated_at_ms || t - value.updated_at_ms > SESSION_TTL_MS) {
      sessionStore.delete(key);
    }
  }
  if (sessionStore.size <= MAX_SESSIONS) return;
  const sorted = [...sessionStore.entries()].sort((a, b) => (a[1]?.updated_at_ms || 0) - (b[1]?.updated_at_ms || 0));
  const toRemove = sorted.slice(0, sessionStore.size - MAX_SESSIONS);
  toRemove.forEach(([key]) => sessionStore.delete(key));
}

function includesAny(text, keywords) {
  const src = String(text || '').toLowerCase();
  return keywords.some((k) => src.includes(String(k).toLowerCase()));
}

function detectFeedbackSignals(query = '') {
  const q = String(query || '');
  const signals = {
    irritation: includesAny(q, ['따가', '자극', '화끈', '눈시림', '간지러', '알러지', '알레르기']),
    not_fit: includesAny(q, ['안 맞', '안맞', '별로', '실패', '밀림', '뜨', '겉돌', '안 맞아요']),
    oily_dislike: includesAny(q, ['번들', '유분', '기름짐', '끈적']),
    heavy_dislike: includesAny(q, ['답답', '무겁', '겉돌']),
  };
  return signals;
}

export function getSessionContext(sessionKey = 'global') {
  pruneExpired();
  const key = toKey(sessionKey);
  const current = sessionStore.get(key);
  if (!current) {
    return {
      reactive_signals: [],
      negative_preferences: [],
      updated_at_ms: 0,
    };
  }
  return {
    reactive_signals: Array.isArray(current.reactive_signals) ? current.reactive_signals : [],
    negative_preferences: Array.isArray(current.negative_preferences) ? current.negative_preferences : [],
    recent_main_base_names: Array.isArray(current.recent_main_base_names) ? current.recent_main_base_names : [],
    recent_main_forms: Array.isArray(current.recent_main_forms) ? current.recent_main_forms : [],
    recent_main_category: current.recent_main_category || null,
    updated_at_ms: current.updated_at_ms || 0,
  };
}

export function updateSessionContext(sessionKey = 'global', { query = '', parsedIntent = null, mainRecommendations = [] } = {}) {
  const key = toKey(sessionKey);
  const previous = getSessionContext(key);
  const signalSet = new Set(previous.reactive_signals || []);
  const negativeSet = new Set(previous.negative_preferences || []);
  const recentBaseNames = Array.isArray(previous.recent_main_base_names) ? [...previous.recent_main_base_names] : [];
  const recentForms = Array.isArray(previous.recent_main_forms) ? [...previous.recent_main_forms] : [];

  const feedback = detectFeedbackSignals(query);
  if (feedback.irritation) signalSet.add('irritation');
  if (feedback.not_fit) signalSet.add('not_fit');
  if (feedback.oily_dislike) negativeSet.add('oily');
  if (feedback.heavy_dislike) negativeSet.add('heavy');

  if (parsedIntent?.skin_type === 'sensitive') signalSet.add('irritation');
  if ((parsedIntent?.concern || []).includes('soothing')) signalSet.add('irritation');

  const latestBases = (Array.isArray(mainRecommendations) ? mainRecommendations : [])
    .map((x) => String(x?.base_name || '').trim())
    .filter(Boolean);
  const mergedBases = [...new Set([...latestBases, ...recentBaseNames])].slice(0, 12);
  const latestForms = (Array.isArray(mainRecommendations) ? mainRecommendations : [])
    .map((x) => String(x?.form || '').trim())
    .filter(Boolean);
  const mergedForms = [...new Set([...latestForms, ...recentForms])].slice(0, 6);

  sessionStore.set(key, {
    reactive_signals: [...signalSet],
    negative_preferences: [...negativeSet],
    recent_main_base_names: mergedBases,
    recent_main_forms: mergedForms,
    recent_main_category: parsedIntent?.requested_category || previous.recent_main_category || null,
    updated_at_ms: now(),
  });
}
