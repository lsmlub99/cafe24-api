/**
 * [운영 전환 포인트] OAuth CSRF 방어용 State 저장소 (메모리 구조)
 * 10분(TTL) 만료 로직과 가비지 컬렉션 구조를 추가했습니다.
 * (운영 시 Redis SET EX 명령어 기반으로 대체 권장)
 */
const stateMap = new Map();
const TTL_MS = 10 * 60 * 1000; // 10분 유효기간

export const stateStore = {
  // 세션 단위로 난수(state)와 생성 시점을 저장
  save: (sessionId, state) => {
    stateMap.set(sessionId, {
      state: state,
      createdAt: Date.now()
    });
  },
  
  // 검증과 동시에 사용 처리(삭제)
  verifyAndConsume: (sessionId, state) => {
    const record = stateMap.get(sessionId);
    
    // 데이터 없음 또는 불일치
    if (!record || record.state !== state) return false;
    
    // 타임아웃(유효기간 초과) 확인 여부
    if (Date.now() - record.createdAt > TTL_MS) {
      stateMap.delete(sessionId);
      return false;
    }
    
    // 정상 검증
    stateMap.delete(sessionId);
    return true;
  },

  // 만료된 잔여 데이터 주기적 청소
  cleanupProcess: () => {
    const now = Date.now();
    for (const [key, record] of stateMap.entries()) {
      if (now - record.createdAt > TTL_MS) {
        stateMap.delete(key);
      }
    }
  }
};

// 1시간마다 메모리 청소 로직 가동 (운영 코드 품질 관점에서 타이머 ID 보관)
let cleanupTimer = setInterval(() => {
  stateStore.cleanupProcess();
}, 60 * 60 * 1000);

// 테스트 환경 등에서 프로세스 종료 시 타이머를 정리할 수 있는 인터페이스 제공
export const stopStateCleanup = () => {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
};
