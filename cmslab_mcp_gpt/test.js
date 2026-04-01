const { searchProducts, getProductDetail } = require('./server.js');

// search_products 테스트
console.log('=== search_products 테스트 ===');
try {
  const searchResult = searchProducts({
    skin_type: '민감성',
    concerns: ['붉은기', '속건조'],
    category: '세럼',
    time_of_use: '아침'
  });
  console.log(JSON.stringify(searchResult, null, 2));
} catch (error) {
  console.error('search_products 오류:', error.message);
}

// get_product_detail 테스트
console.log('\n=== get_product_detail 테스트 ===');
try {
  const detailResult = getProductDetail({ product_id: 'P001' });
  console.log(JSON.stringify(detailResult, null, 2));
} catch (error) {
  console.error('get_product_detail 오류:', error.message);
}

// 없는 제품 테스트
console.log('\n=== 없는 제품 테스트 ===');
try {
  const detailResult = getProductDetail({ product_id: 'P999' });
  console.log(JSON.stringify(detailResult, null, 2));
} catch (error) {
  console.error('get_product_detail 오류:', error.message);
}