# 🥃 위스키 가격 비교 — 창이공항 면세점 vs 일본 시중

싱가포르 창이공항 면세점(iShopChangi) 위스키 가격과 일본 시중 최저가를 **엔화 기준**으로 비교하는 모바일 웹앱.

**Live:** https://diff-whisky-price.netlify.app

---

## 주요 기능

- **실시간 환율 적용** — frankfurter.app API로 SGD→JPY 환율을 실시간 조회
- **17종 싱글몰트 위스키** — Macallan, Lagavulin, Laphroaig, Ardbeg, Redbreast, Aultmore 등
- **카테고리 필터** — Islay / Speyside / Island·Highland / Irish
- **용량 보정 비교** — 창이(1000ml)와 일본(700ml)처럼 용량이 다를 때 ml당 비교 모드 제공
- **절약금액/절약률 정렬** — 어디서 사는 게 유리한지 한눈에 확인
- **매일 자동 가격 갱신** — GitHub Actions + Playwright로 양쪽 가격 자동 수집

---

## 가격 취득 경로

### 🛫 창이공항 면세점 (iShopChangi)

| 항목 | 내용 |
|------|------|
| **소스** | https://www.ishopchangi.com |
| **방식** | Playwright 헤드리스 브라우저 (SPA 렌더링 필수) |
| **모드** | Traveller 모드 (`?cmode=tr`) |
| **스크립트** | `scripts/update-changi-prices.mjs` |
| **수집 흐름** | 브랜드별 페이지 접근 → DOM에서 제품명+S$ 가격 추출 → 정규식 매칭으로 제품 식별 → 매칭 실패 시 검색 폴백 → 미발견 시 미판매 처리 |

### 🗾 일본 시중 최저가 (Rakuten + Yahoo Shopping)

| 항목 | 내용 |
|------|------|
| **소스** | search.rakuten.co.jp / shopping.yahoo.co.jp |
| **방식** | Playwright 헤드리스 브라우저 |
| **스크립트** | `scripts/update-japan-prices.mjs` |
| **수집 흐름** | 일본어 검색어 + "700ml" 키워드로 검색 → 가격 오름차순 정렬 → 미니어처/샘플 필터링(¥2,500 이상만) → Rakuten/Yahoo 중 최저가 선택 |

### 💱 환율

| 항목 | 내용 |
|------|------|
| **소스** | frankfurter.app (ECB 기준) |
| **방식** | Netlify Function (`netlify/functions/exchange-rate.js`) |
| **대체값** | API 실패 시 ¥112.00 fallback |

---

## 가격 갱신 → 배포 파이프라인

```
┌─────────────────────────────────────────────────────┐
│  GitHub Actions (매일 09:00 KST / workflow_dispatch) │
├─────────────────────────────────────────────────────┤
│                                                     │
│  1. npm ci + Playwright Chromium 설치               │
│                                                     │
│  2. 창이 가격 스크래핑 (Playwright)                  │
│     scripts/update-changi-prices.mjs                │
│     → data/whiskies.json 갱신                       │
│                                                     │
│  3. 일본 가격 스크래핑 (Playwright)                  │
│     scripts/update-japan-prices.mjs                 │
│     → data/whiskies.json 갱신                       │
│                                                     │
│  4. cp data/whiskies.json → public/data.json        │
│                                                     │
│  5. 변경사항 있으면 자동 커밋 + git push             │
│                                                     │
└──────────────────────┬──────────────────────────────┘
                       │ git push (main)
                       ▼
┌─────────────────────────────────────────────────────┐
│  Netlify 자동 배포                                   │
│  - publish: public/                                 │
│  - functions: netlify/functions/                    │
│  - 라이브 반영: https://diff-whisky-price.netlify.app│
└─────────────────────────────────────────────────────┘
```

---

## 프로젝트 구조

```
diffWhiskyPrice/
├── data/
│   └── whiskies.json          # 마스터 데이터 (제품 목록 + 가격)
├── public/
│   ├── index.html             # 프론트엔드 SPA (CSS/JS 인라인)
│   └── data.json              # 프론트엔드용 데이터 (whiskies.json 복사본)
├── netlify/
│   └── functions/
│       ├── exchange-rate.js   # SGD→JPY 실시간 환율 API
│       └── whisky-prices.js   # (레거시, 미사용)
├── scripts/
│   ├── update-changi-prices.mjs  # 창이 가격 Playwright 스크래핑
│   └── update-japan-prices.mjs   # 일본 가격 Playwright 스크래핑
├── .github/
│   └── workflows/
│       └── update-prices.yml  # 가격 자동 갱신 Action (매일 09:00 KST)
├── netlify.toml               # Netlify 설정
└── package.json               # 의존성 (playwright)
```

---

## 데이터 구조 (`data/whiskies.json`)

```jsonc
{
  "meta": {
    "lastUpdated": "2026-03-19",
    "changiSource": "iShopChangi.com (Traveller mode, auto-scraped)",
    "japanSource": "rakuten.co.jp / shopping.yahoo.co.jp (最安値)"
  },
  "products": [
    {
      "id": "macallan-12dc",
      "name": "The Macallan 12 Year Double Cask",
      "nameKR": "맥캘란 12년 더블 캐스크",
      "brand": "Macallan",
      "category": "speyside",       // islay | speyside | island | highland | irish
      "searchTermJP": "マッカラン 12年 ダブルカスク",
      "changi": {
        "priceSGD": 102.20,         // null이면 미판매
        "volumeML": 700,
        "available": true,
        "verifiedDate": "2026-03-19"
      },
      "japan": {
        "priceJPY": 8397,
        "volumeML": 700,
        "verifiedDate": "2026-03-19",
        "source": "rakuten:¥8,397 / yahoo:¥9,200"
      }
    }
  ]
}
```

---

## 로컬 개발

```bash
# 의존성 설치
npm install

# Playwright 브라우저 설치 (스크래핑용)
npx playwright install chromium

# 개발 서버 (Netlify Functions 포함)
npm run dev

# 가격 수동 갱신
npm run update-changi   # 창이만
npm run update-japan    # 일본만
npm run update-all      # 양쪽 모두
```

---

## 정기 처리 (GitHub Actions)

| 항목 | 내용 |
|------|------|
| **워크플로우** | `.github/workflows/update-prices.yml` |
| **스케줄** | 매일 09:00 KST (cron: `0 0 * * *` UTC) |
| **수동 실행** | GitHub Actions 탭 → "Run workflow" |
| **소요 시간** | 약 10~15분 |
| **커밋 주체** | `github-actions[bot]` |
| **커밋 조건** | `data/whiskies.json`에 변경사항이 있을 때만 |
