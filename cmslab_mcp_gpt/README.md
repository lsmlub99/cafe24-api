# MCP 제품 추천 서버 (Remote HTTP 버전)

이 프로젝트는 Node.js + Express로 구현된 HTTP 기반 MCP (Model Context Protocol) 서버로, ChatGPT의 "Create app > MCP server URL"에 연결 가능한 remote MCP 서버입니다.

## 기능

- **search_products**: 피부 타입, 관심사, 카테고리, 사용 시간에 따라 제품을 검색하고 점수 기반으로 추천합니다.
- **get_product_detail**: 특정 제품의 상세 정보를 가져옵니다.

## 🚀 빠른 시작

### 1단계: 의존성 설치
```bash
npm install
```

### 2단계: 서버 실행
```bash
node server.js
```

서버가 포트 3002에서 실행됩니다:
- **REST API**: http://localhost:3002
- **MCP 엔드포인트**: http://localhost:3002/mcp

### 3단계: ngrok으로 외부 공개 (선택)

다른 터미널에서:
```bash
.\ngrok http 3002
```

생성된 HTTPS URL을 ChatGPT에 입력합니다.

## 로컬 테스트

### 함수 직접 테스트

`test.js`를 사용하여 함수를 직접 테스트합니다:
```bash
node test.js
```

### MCP API 테스트

PowerShell에서 tools/list 요청:
```powershell
$json = '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}';
$bytes = [System.Text.Encoding]::UTF8.GetBytes($json);
Invoke-RestMethod -Method Post -Uri "http://localhost:3002/mcp" -ContentType "application/json; charset=utf-8" -Body $bytes
```

tools/call 요청 (search_products):
```powershell
$json = '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search_products","arguments":{"skin_type":"민감성","concerns":["붉은기"],"category":"세럼","time_of_use":"아침"}}}';
$bytes = [System.Text.Encoding]::UTF8.GetBytes($json);
Invoke-RestMethod -Method Post -Uri "http://localhost:3002/mcp" -ContentType "application/json; charset=utf-8" -Body $bytes
```

## ngrok 설정 (외부 연결)

서버를 공개적으로 연결하려면 ngrok을 사용합니다:

1. **ngrok 설치** (https://ngrok.com/download)
2. **ngrok 토큰 설정**:
   ```bash
   .\ngrok config add-authtoken YOUR_TOKEN
   ```
   (https://dashboard.ngrok.com/ 에서 토큰 확인)
3. **ngrok 시작**:
   ```bash
   .\ngrok http 3002
   ```
4. **생성된 URL 사용** (예: `https://jonie-philanthropic-donetta.ngrok-free.dev`)

## ChatGPT에서 앱 연결하기

1. ChatGPT 홈 → "Explore" → "Create a GPT"
2. "Configure" 탭으로 이동
3. "Actions" 섹션에서 "Create new action"
4. "Import from URL" 선택
5. 다음 URL 입력: `https://your-ngrok-url/mcp`
6. "Save" 후 테스트

### MCP server URL 형식

```
https://your-ngrok-url.ngrok-free.dev/mcp
```

예시:
```
https://jonie-philanthropic-donetta.ngrok-free.dev/mcp
```

## ChatGPT에서 사용 예시

연결 후 이런 명령을 시도해보세요:

- "민감성 피부에 붉은기와 속건조가 있는 사람을 위한 세럼을 추천해줘"
  → search_products MCP tool 호출
- "P001 제품의 상세 정보를 보여줘"
  → get_product_detail MCP tool 호출

## 기술 구조

### MCP 구현

- **프로토콜**: JSON-RPC 2.0 기반
- **연결방식**: HTTP POST + Server-Sent Events (SSE)
- **엔드포인트**: `/mcp`
- **인코딩**: UTF-8

### REST API (직접 호출용)

기존의 REST API도 계속 사용 가능합니다:
- `POST /search_products` - JSON 데이터로 제품 검색
- `POST /get_product_detail` - 제품 상세 정보 조회

## 데이터

제품 데이터는 `products.json` 파일에 저장되어 있습니다. 필요에 따라 이 파일을 수정하여 제품을 추가/변경할 수 있습니다.

## 점수 계산 규칙 (search_products)

- 피부 타입 일치: +2점
- 관심사 일치 (각 관심사마다): +3점
- 카테고리 일치: +2점
- 사용 시간 일치: +1점

점수가 높은 순으로 최대 3개의 제품을 반환하며, score가 0 이하인 제품은 제외됩니다.

## API 엔드포인트

### MCP 엔드포인트
- `GET /mcp` - MCP SSE 연결 (ChatGPT용)
- `POST /mcp` - JSON-RPC 2.0 요청 처리

### REST API 엔드포인트
- `GET /` - Health check (상태 확인)
- `POST /search_products` - 제품 검색
  - Body: `{"skin_type": "민감성", "concerns": ["붉은기"], "category": "세럼", "time_of_use": "아침"}`
- `POST /get_product_detail` - 제품 상세 조회
  - Body: `{"product_id": "P001"}`

## 제품 데이터 포맷

`products.json`에서 제품을 추가할 때 다음 형식을 따르세요:

```json
{
  "id": "P001",
  "name": "제품명",
  "brand": "브랜드",
  "price": 32000,
  "skin_types": ["민감성", "건성"],
  "concerns": ["붉은기", "속건조"],
  "category": "세럼",
  "time_of_use": ["아침", "저녁"],
  "url": "https://example.com/p001"
}
```