import express from 'express';
import crypto from 'crypto';
import { cafe24AuthService } from '../services/cafe24AuthService.js';
import { cafe24ApiService } from '../services/cafe24ApiService.js';
import { stateStore } from '../stores/stateStore.js';
import { tokenStore } from '../stores/tokenStore.js';
import { config } from '../config/env.js';

const router = express.Router();

const maskToken = (token) => {
  if (!token) return null;
  if (token.length <= 8) return '****';
  return token.substring(0, 4) + '*'.repeat(token.length - 8) + token.substring(token.length - 4);
};

// ---------------------------------------------------------
// 1. OAuth 인증 시작
// ---------------------------------------------------------
router.get('/start', (req, res) => {
  let sessionId = req.cookies?.cafe24_session_id;
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    res.cookie('cafe24_session_id', sessionId, {
        httpOnly: true,
        secure: true, // 보안 통신 강제: 반드시 HTTPS 연결
        sameSite: 'lax',
        maxAge: 10 * 60 * 1000 // 10분 쿠키 유지
    });
  }

  const state = crypto.randomBytes(16).toString('hex');
  stateStore.save(sessionId, state); // 10분 TTL 저장

  const authorizeUrl = cafe24AuthService.getAuthorizeUrl(state);
  console.log(`[INFO] OAuth 인증 화면으로 이동합니다. 타겟 쇼핑몰: ${config.MALL_ID}`);
  res.redirect(authorizeUrl);
});

// ---------------------------------------------------------
// 2. OAuth Callback
// ---------------------------------------------------------
router.get('/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;
  const sessionId = req.cookies?.cafe24_session_id;

  if (error) {
    return res.status(400).send(`인증 취소 및 오류: ${error_description}`);
  }

  if (!code || !state || !sessionId) {
    return res.status(400).send("필수 인가 코드가 누락되었거나 연결 세션(10분)이 만료되었습니다.");
  }

  if (!stateStore.verifyAndConsume(sessionId, state)) {
    return res.status(400).send("비정상적인 접근이거나 세션이 만료되었습니다. 처음부터 다시 연동해주세요.");
  }

  try {
    const tokenData = await cafe24AuthService.getAccessToken(code);

    // [핵심 로직] 추출된 데이터를 MongoDB에 비동기 저장
    await tokenStore.saveTokens(
      config.MALL_ID,
      tokenData.access_token,
      tokenData.refresh_token,
      tokenData.expires_at
    );

    res.clearCookie('cafe24_session_id');
    res.send(`
      <h2>✅ 권한 발급 및 DB 영구 저장 성공 (${config.MALL_ID})</h2>
      <p>토큰이 서버 데이터베이스에 기록되어 재부팅해도 사라지지 않습니다.</p>
      <a href="/cafe24/products">상품 조회 테스트 바로가기</a>
    `);

  } catch (err) {
    console.error(`[ERROR] 교환 오류:`, err);
    res.status(500).send("서버 측 카페24 API 내부 연동 오류");
  }
});

// ---------------------------------------------------------
// 3. 발급된 토큰 상태 파악 (개발 환경 전용)
// ---------------------------------------------------------
router.get('/token', async (req, res) => {
  if (config.NODE_ENV !== 'development') {
    return res.status(403).json({ 
      error: "Forbidden", 
      message: "해당 엔드포인트는 운영 환경에서 접근할 수 없습니다. (NODE_ENV !== development)" 
    });
  }

  // 비동기 DB 조회 반영
  const tokens = await tokenStore.getTokens(config.MALL_ID);
  
  if (!tokens.accessToken) {
    return res.status(404).json({ message: "DB에 저장된 토큰이 없습니다. 만료되었거나 연동 전 상태입니다." });
  }

  res.json({
    mallId: config.MALL_ID,
    accessTokenMasked: maskToken(tokens.accessToken),
    refreshTokenMasked: maskToken(tokens.refreshToken),
    expiresAt: tokens.expiresAt,
    notice: "[개발 점검 전용] 개발 환경 식별 아래 인증 토큰이 마스킹 처리되어 반환됩니다."
  });
});

// ---------------------------------------------------------
// 4. 리프레시 토큰으로 Access Token 자동/수동 재발급
// ---------------------------------------------------------
router.get('/refresh', async (req, res) => {
  // 비동기로 DB에서 리프레시 토큰 읽어오기
  const refreshToken = await tokenStore.getRefreshToken(config.MALL_ID);
  
  if (!refreshToken) {
    return res.status(400).json({ message: "사용 가능한 Refresh Token이 DB에 없습니다." });
  }

  try {
    const tokenData = await cafe24AuthService.refreshAccessToken(refreshToken);

    // 갱신된 데이터를 비동기로 다시 DB에 덮어씌움
    await tokenStore.saveTokens(
      config.MALL_ID,
      tokenData.access_token,
      tokenData.refresh_token || refreshToken,
      tokenData.expires_at
    );

    res.json({ message: "재발급 및 DB 업데이트 완료 처리", mallId: config.MALL_ID, expiresAt: tokenData.expires_at });
  } catch (err) {
    console.error(`[ERROR] 재발급 서버 내부 오류:`, err);
    res.status(500).send("통신 에러가 발생하여 갱신하지 못했습니다.");
  }
});

// ---------------------------------------------------------
// 5. 상품 조회 테스트
// ---------------------------------------------------------
router.get('/products', async (req, res) => {
  // 비동기로 DB에서 엑세스 토큰 읽어오기
  const accessToken = await tokenStore.getAccessToken(config.MALL_ID);

  if (!accessToken) {
    return res.status(401).send(`접근 토큰 없음. <a href="/cafe24/start">인증</a> 진입이 필요합니다.`);
  }

  try {
    const data = await cafe24ApiService.getProducts(accessToken, 5);
    res.json(data);
  } catch (err) {
    // 상품 조회 시 401 권한 만료가 확인된다면 자동으로 리프레시를 유도
    if (err.status === 401) {
       return res.status(401).send(`
          <h2>⚠ 권한 만료 (401)</h2>
          <p>DB에 있는 엑세스 토큰이 만료되었습니다. 아래 링크를 통해 갱신하세요.</p>
          <a href="/cafe24/refresh">토큰 리프레시 진행</a>
       `);
    }
    console.error(`[ERROR] 조회 API 오류:`, err);
    res.status(500).send("API 통신 실패");
  }
});

export default router;
