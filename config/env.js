import dotenv from 'dotenv';
dotenv.config();

export const config = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: process.env.PORT || 3000,
  MALL_ID: process.env.MALL_ID, // 하드코딩 제거
  CLIENT_ID: process.env.CLIENT_ID,
  CLIENT_SECRET: process.env.CLIENT_SECRET,
  REDIRECT_URI: process.env.REDIRECT_URI,
  SCOPE: process.env.SCOPE // 하드코딩 제거
};

// 필수 환경변수 누락 시 즉시 서버 구동 실패 처리 (장애 전파 방지)
const requiredKeys = ['MALL_ID', 'CLIENT_ID', 'CLIENT_SECRET', 'REDIRECT_URI', 'SCOPE'];
for (const key of requiredKeys) {
  if (!config[key]) {
    console.error(`❌ [FATAL] 필수 환경변수 '${key}'(이)가 설정되지 않았습니다. .env 파일을 작성해주십시오.`);
    process.exit(1); 
  }
}
