export const RECOMMENDATION_POLICY = {
  limits: {
    defaultMain: 3,
    defaultSecondary: 2,
    stage1TopK: 60,
    stage2TopK: 15,
  },
  rerank: {
    llmWeight: 0.45,
    model: 'gpt-4o-mini',
  },
  scoring: {
    categoryGate: 1000,
    promoPenalty: -12,
    reviewCap: 25,
    ratingCap: 20,
    salesCap: 25,
    bestTagBonus: 6,
    conditionHitWeight: 6,
    conditionCap: 48,
  },
};

export const RECOMMENDATION_TAXONOMY = {
  categories: {
    sunscreen: ['선크림', '썬크림', '선케어', 'sun', 'sunscreen', 'uv', '자외선'],
    toner: ['토너', '스킨', 'toner'],
    serum: ['세럼', '앰플', 'serum', 'ampoule'],
    cream: ['크림', '수분크림', '보습크림', '로션', 'cream', 'lotion'],
    cushion: ['쿠션', 'cushion'],
    bb: ['비비', '비비크림', 'bb'],
    cleansing: ['클렌징', '세안', 'cleansing'],
    mask: ['마스크', '마스크팩', '팩', 'mask'],
    inner: ['이너뷰티', 'inner'],
  },
  forms: {
    cream: ['선크림', '썬크림', '크림', 'cream', 'sunscreen', 'sun cream'],
    lotion: ['로션', 'lotion', 'sun lotion'],
    cushion: ['쿠션', 'cushion', 'sun cushion'],
    serum: ['세럼', '앰플', 'serum', 'ampoule', 'sun serum'],
    spray: ['스프레이', '미스트', 'spray', 'mist', 'sun spray'],
    stick: ['스틱', '스틱밤', 'stick', 'stick balm', 'sun stick'],
  },
  skinTypes: {
    dry: ['건성', 'dry'],
    oily: ['지성', 'oily'],
    combination: ['복합성', '수부지', 'combination'],
    sensitive: ['민감', '민감성', 'sensitive'],
  },
  concerns: {
    hydration: ['보습', '수분', '건조', '당김', 'moist', 'hydration'],
    soothing: ['진정', '민감', '붉은기', '열감', 'soothing', 'calming'],
    sebum_control: ['유분', '번들', '피지', '모공', 'sebum', 'oily'],
    tone_up: ['톤업', '잡티', '톤 보정', '커버', 'tone', 'cover'],
    uv_protection: ['자외선', 'uv', 'sun'],
  },
  situations: {
    outdoor: ['야외', '골프', '등산', '운동', '러닝', 'outside', 'outdoor'],
    makeup_before: ['메이크업 전', '화장 전', '밀림', '궁합', 'makeup'],
    daily: ['데일리', '매일', 'daily'],
  },
  preferences: {
    lightweight: ['가벼운', '산뜻', '보송', 'lightweight', 'fresh'],
    moisturizing: ['촉촉', '보습감', 'moisturizing'],
    low_white_cast: ['백탁', 'white cast'],
  },
  noveltyKeywords: ['신상', '신제품', '새로 나온', 'new'],
  popularityKeywords: ['인기', '베스트', 'best', 'popular', '잘나가는'],
  crossSellCategory: {
    sunscreen: ['toner', 'cream', 'serum'],
    toner: ['serum', 'cream'],
    serum: ['toner', 'cream'],
    cream: ['toner', 'serum'],
    cushion: ['sunscreen', 'toner'],
    bb: ['sunscreen', 'toner'],
  },
};
