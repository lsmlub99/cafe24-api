import dotenv from 'dotenv';
dotenv.config();

export const config = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: process.env.PORT || 3000,
  MONGO_URI: process.env.MONGO_URI, // MongoDB 연결을 위한 변수 추가
  MALL_ID: process.env.MALL_ID,
  CLIENT_ID: process.env.CLIENT_ID,
  CLIENT_SECRET: process.env.CLIENT_SECRET,
  REDIRECT_URI: process.env.REDIRECT_URI,
  SCOPE: process.env.SCOPE
};

// 필수 환경변수 누락 시 즉시 서버 구동 실패 처리 (장애 전파 방지)
const requiredKeys = ['MALL_ID', 'CLIENT_ID', 'CLIENT_SECRET', 'REDIRECT_URI', 'SCOPE', 'MONGO_URI'];
for (const key of requiredKeys) {
  if (!config[key]) {
    console.error(`❌ [FATAL] 필수 환경변수 '${key}'(이)가 설정되지 않았습니다. .env 파일을 작성해주십시오.`);
    process.exit(1); 
  }
}
