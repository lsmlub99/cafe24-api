import { includesAny, findFirstAliasKey, findAllAliasKeys, uniq, lower } from './shared.js';

function detectSortIntent(parsedIntent, query, taxonomy) {
  const q = lower(query);
  if (parsedIntent.novelty_request) return 'new_arrival';
  if (includesAny(q, taxonomy.popularityKeywords || [])) return 'popular';
  if (parsedIntent.preference.length || parsedIntent.situation.length || parsedIntent.skin_type || parsedIntent.concern.length) {
    return 'condition_based';
  }
  return 'popular';
}

export function parseUserIntent(args = {}, taxonomy) {
  const q = `${args.q || ''} ${args.query || ''}`.trim();
  const categoryText = `${args.category || ''} ${q}`.trim();
  const formText = `${args.form || ''} ${args.category || ''} ${q}`.trim();

  const requestedCategory = findFirstAliasKey(categoryText, taxonomy.categories);
  const requestedForm = findFirstAliasKey(formText, taxonomy.forms);
  const skinTypeFromField = findFirstAliasKey(args.skin_type || '', taxonomy.skinTypes);
  const skinTypeFromQuery = findFirstAliasKey(q, taxonomy.skinTypes);
  const skinType = skinTypeFromField || skinTypeFromQuery || null;

  const concern = uniq([
    ...findAllAliasKeys(Array.isArray(args.concerns) ? args.concerns.join(' ') : '', taxonomy.concerns),
    ...findAllAliasKeys(q, taxonomy.concerns),
  ]);
  const situation = findAllAliasKeys(q, taxonomy.situations);
  const preference = findAllAliasKeys(q, taxonomy.preferences);
  const noveltyRequest = includesAny(q, taxonomy.noveltyKeywords || []);
  const explicitFormRequest = Boolean(requestedForm);

  const parsed = {
    requested_category: requestedCategory,
    requested_category_ids: Array.isArray(args.target_category_ids) ? args.target_category_ids : [],
    requested_form: requestedForm,
    explicit_form_request: explicitFormRequest,
    skin_type: skinType,
    concern,
    situation,
    preference,
    novelty_request: noveltyRequest,
    sort_intent: 'popular',
    query: q,
  };

  parsed.sort_intent = detectSortIntent(parsed, q, taxonomy);
  return parsed;
}
