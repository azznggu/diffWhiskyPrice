/**
 * 일본 시장 위스키 최저가 자동 갱신 스크립트
 * Yahoo!ショッピング 상품검색 API (v3)로 최저가를 수집합니다.
 * (기존 Playwright 스크래핑은 Yahoo가 GitHub Actions 등 해외 데이터센터 IP를
 *  HTTP 500으로 차단해 동작하지 않아 공식 API 방식으로 교체 — 2026-11-16)
 *
 * 검색어에 "700ml" 포함 + 가격 하한 ¥2,500으로 미니어처/샘플 제외
 * 상품명, 출처 URL도 함께 수집합니다.
 * 배송료는 API가 구분 코드(무료/조건부/설정없음)만 제공하므로,
 * 무료배송이면 0, 그 외는 금액 미상으로 0 처리하고 합계는 상품가 기준입니다.
 *
 * Usage: YAHOO_APP_ID=<Client ID> node scripts/update-japan-prices.mjs
 * YAHOO_APP_ID가 없으면 기존 데이터를 건드리지 않고 경고만 남기고 종료합니다.
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = resolve(__dirname, '../data/whiskies.json');

const API_URL = 'https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch';
const DELAY_MS = 400;
// 미니어처/샘플 제외를 위한 최소 가격
const MIN_PRICE = 2500;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Yahoo Shopping API 검색 → 최저가 아이템 반환
 */
async function searchYahoo(appId, searchTerm) {
  const fullTerm = `${searchTerm} 700ml`;
  const params = new URLSearchParams({
    appid: appId,
    query: fullTerm,
    sort: '+price',
    price_from: String(MIN_PRICE),
    results: '30',
    in_stock: 'true',
  });
  console.log(`    [Yahoo API] "${fullTerm}"`);

  const res = await fetch(`${API_URL}?${params}`);
  if (!res.ok) {
    throw new Error(`API HTTP ${res.status}`);
  }
  const json = await res.json();
  const hits = json.hits || [];

  // 검색어 첫 토큰 = 브랜드명 (오매칭 방지, 기존 스크래퍼와 동일 규칙)
  const brandKeyword = searchTerm.split(/\s+/)[0];

  const candidates = [];
  for (const hit of hits) {
    const name = hit.name || '';
    if (brandKeyword && !name.includes(brandKeyword)) continue;
    // 미니어처/샘플 제외
    if (/(?:50|100|200)\s*ml/i.test(name) && !/700\s*ml/i.test(name)) continue;
    if (/ミニチュア|ミニボトル|サンプル|お試し/i.test(name)) continue;
    if (typeof hit.price !== 'number' || hit.price < MIN_PRICE) continue;

    const shippingCode = hit.shipping ? hit.shipping.code : 1;
    const shipping = shippingCode === 2 ? 0 : 0; // 무료(2) 외에는 금액 미상 → 0
    candidates.push({
      price: hit.price,
      shipping,
      total: hit.price + shipping,
      freeShipping: shippingCode === 2,
      title: name,
      url: hit.url || null,
    });
  }

  if (candidates.length === 0) {
    console.log(`      → 가격 미발견 (히트 ${hits.length}건, 필터 후 0건)`);
    return null;
  }
  // 최저가 우선, 동가이면 무료배송 우선
  candidates.sort((a, b) => (a.total - b.total) || ((b.freeShipping ? 1 : 0) - (a.freeShipping ? 1 : 0)));
  const best = candidates[0];
  console.log(`      → ¥${best.price.toLocaleString()} (${candidates.length}건 중 최저)`);
  if (best.title) console.log(`      → 상품: ${best.title.substring(0, 60)}`);
  if (best.url) console.log(`      → ${best.url}`);
  return best;
}

async function main() {
  console.log('🚀 일본 시장 위스키 최저가 자동 갱신 시작 (Yahoo Shopping API)...\n');

  const appId = process.env.YAHOO_APP_ID;
  if (!appId) {
    console.log('⚠️  YAHOO_APP_ID가 설정되지 않았습니다. 일본 가격 데이터는 기존 값을 유지합니다.');
    console.log('    (GitHub Secrets에 YAHOO_APP_ID를 등록하면 자동 수집이 시작됩니다.)');
    return;
  }

  const data = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));
  const today = new Date().toISOString().split('T')[0];
  let updated = 0;
  let failed = 0;

  console.log(`🔍 ${data.products.length}개 제품 가격 조회 시작...\n`);

  for (const product of data.products) {
    const term = product.searchTermJP;
    if (!term) {
      console.log(`⏭️  ${product.name}: 검색어 없음, 스킵`);
      continue;
    }

    console.log(`\n🔎 ${product.nameKR} (${product.name})`);

    let result = null;
    let errored = false;
    try {
      result = await searchYahoo(appId, term);
    } catch (err) {
      console.log(`      → 에러: ${err.message} (기존 값 유지)`);
      errored = true;
      failed++;
    }
    await sleep(DELAY_MS);

    if (result !== null) {
      const old = product.japan.priceJPY;
      product.japan.priceJPY = result.price;
      product.japan.shippingJPY = result.shipping;
      product.japan.totalJPY = result.total;
      product.japan.productTitle = result.title || '';
      product.japan.verifiedDate = today;
      product.japan.source = `yahoo-api:¥${result.price.toLocaleString()}`;
      product.japan.sourceUrl = result.url || null;

      const diff = old ? result.price - old : 0;
      const arrow = old ? (diff > 0 ? '↑' : diff < 0 ? '↓' : '=') : '🆕';
      console.log(`  ✅ 최저가: ¥${result.price.toLocaleString()} (이전: ${old ? '¥' + old.toLocaleString() : '없음'} ${arrow})`);
      updated++;
    } else if (!errored) {
      // API는 정상 응답했지만 해당 상품이 없는 경우만 미발견 처리
      console.log(`  ❌ 가격 조회 실패 → 미판매 처리`);
      product.japan.priceJPY = null;
      product.japan.shippingJPY = 0;
      product.japan.totalJPY = null;
      product.japan.productTitle = '';
      product.japan.verifiedDate = today;
      product.japan.source = 'yahoo-api:미발견';
      product.japan.sourceUrl = null;
    }
  }

  data.meta.lastUpdated = today;
  data.meta.japanSource = 'shopping.yahoo.co.jp (API 最安値)';

  writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + '\n');
  console.log(`\n✅ 완료! ${updated}/${data.products.length} 제품 일본 가격 갱신됨. (API 오류 ${failed}건)`);
  console.log(`📄 ${DATA_PATH} 저장됨.`);
}

main().catch(err => {
  console.error('❌ 스크립트 실행 실패:', err);
  process.exit(1);
});
