/**
 * 일본 시장 위스키 최저가 자동 갱신 스크립트
 * Playwright로 Yahoo Shopping 검색 결과를 스크래핑하여 최저가를 수집합니다.
 * 검색어에 "700ml" 포함 + 가격 하한 ¥2,500으로 미니어처/샘플 제외
 * 상품명, 배송료, 출처 URL도 함께 수집합니다.
 *
 * Usage: node scripts/update-japan-prices.mjs
 * 사전 요구: npx playwright install chromium
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = resolve(__dirname, '../data/whiskies.json');

const DELAY_MS = 3000;
// 미니어처/샘플 제외를 위한 최소 가격
const MIN_PRICE = 2500;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Yahoo Shopping 검색 → 가격 + 상품명 + 배송료 + URL 추출 (Playwright)
 */
async function searchYahoo(page, searchTerm) {
  const fullTerm = `${searchTerm} 700ml`;
  const url = `https://shopping.yahoo.co.jp/search?p=${encodeURIComponent(fullTerm)}&X=2&sort=%2Bprice`;
  console.log(`    [Yahoo] "${fullTerm}"`);

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForSelector('[class*="Product"], [class*="item"], [class*="mdSearchResult"]', { timeout: 10000 }).catch(() => {});
    await sleep(2000);

    // 검색어에서 브랜드명을 추출 (첫 번째 토큰 = 브랜드명)
    const brandKeyword = searchTerm.split(/\s+/)[0]; // e.g. "ラフロイグ", "マッカラン"

    const results = await page.evaluate(({ min, brand }) => {
      const items_found = [];

      // Yahoo Shopping 검색 결과 아이템 단위로 처리
      const items = document.querySelectorAll(
        '[class*="SearchResultItem__mJ7vY"], [class*="SearchResult_SearchResultItem"], [class*="ProductList"] li, [class*="mdSearchResult"] li'
      );
      for (const item of items) {
        const text = item.textContent || '';
        // 미니어처/샘플 제외
        if (/(?:50|100|200)\s*ml/i.test(text) && !/700\s*ml/i.test(text)) continue;
        if (/ミニチュア|ミニボトル|サンプル|お試し/i.test(text)) continue;

        // 상품명 추출
        const titleEl = item.querySelector('a[class*="detailLink"]');
        const title = titleEl ? titleEl.textContent.trim() : '';

        // ★ 브랜드명이 상품명에 포함되어 있는지 검증 (오매칭 방지)
        if (title && brand && !title.includes(brand)) continue;

        const m = text.match(/([\d,]+)\s*円/) || text.match(/¥\s*([\d,]+)/);
        if (m) {
          const price = parseInt(m[1].replace(/,/g, ''));
          if (price >= min) {
            // 상품 상세 링크 추출
            const link = item.querySelector('a[class*="detailLink"]')
              || item.querySelector('a[class*="ImageLink"]')
              || item.querySelector('a[href*="store.shopping.yahoo"]')
              || item.querySelector('a[href]');
            const href = link ? link.href : null;

            // 배송료 추출
            const postageEl = item.querySelector('[class*="ItemPostage"]');
            const postageText = postageEl ? postageEl.textContent.trim() : '';
            let shipping = 0;
            if (/送料無料/.test(postageText)) {
              shipping = 0;
            } else {
              const sm = postageText.match(/送料([\d,]+)円/);
              if (sm) shipping = parseInt(sm[1].replace(/,/g, ''));
            }

            items_found.push({ price, shipping, total: price + shipping, title, url: href });
          }
        }
      }

      // 폴백: 가격 요소에서 직접 추출 (상품명/배송료 없음)
      if (items_found.length === 0) {
        const priceEls = document.querySelectorAll('[class*="ItemPrice"], [class*="Price"], [class*="price"]');
        for (const el of priceEls) {
          const text = el.textContent || '';
          const m = text.match(/([\d,]+)\s*円/) || text.match(/¥\s*([\d,]+)/);
          if (m) {
            const price = parseInt(m[1].replace(/,/g, ''));
            if (price >= min) items_found.push({ price, shipping: 0, total: price, title: '', url: null });
          }
        }
      }

      return items_found;
    }, { min: MIN_PRICE, brand: brandKeyword });

    if (results.length > 0) {
      // 배송료 포함 총액 기준 최저가 아이템 찾기
      const best = results.reduce((a, b) => a.total <= b.total ? a : b);
      console.log(`      → ¥${best.price.toLocaleString()} + 送料¥${best.shipping.toLocaleString()} = 合計¥${best.total.toLocaleString()} (${results.length}건 중 최저)`);
      if (best.title) console.log(`      → 상품: ${best.title.substring(0, 60)}`);
      if (best.url) console.log(`      → ${best.url}`);
      return best;
    }
    console.log(`      → 가격 미발견`);
    return null;
  } catch (err) {
    console.log(`      → 에러: ${err.message}`);
    return null;
  }
}

async function main() {
  console.log('🚀 일본 시장 위스키 최저가 자동 갱신 시작 (Yahoo Shopping)...\n');
  console.log(`   최소 가격: ¥${MIN_PRICE.toLocaleString()} (미니어처/샘플 제외)\n`);

  const data = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));
  const today = new Date().toISOString().split('T')[0];
  let updated = 0;

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    locale: 'ja-JP',
  });

  const page = await context.newPage();

  console.log(`🔍 ${data.products.length}개 제품 가격 조회 시작...\n`);

  for (const product of data.products) {
    const term = product.searchTermJP;
    if (!term) {
      console.log(`⏭️  ${product.name}: 검색어 없음, 스킵`);
      continue;
    }

    console.log(`\n🔎 ${product.nameKR} (${product.name})`);

    const yahooResult = await searchYahoo(page, term);
    await sleep(DELAY_MS);

    if (yahooResult !== null) {
      const old = product.japan.priceJPY;
      product.japan.priceJPY = yahooResult.price;
      product.japan.shippingJPY = yahooResult.shipping;
      product.japan.totalJPY = yahooResult.total;
      product.japan.productTitle = yahooResult.title || '';
      product.japan.verifiedDate = today;
      product.japan.source = `yahoo:¥${yahooResult.price.toLocaleString()}`;
      product.japan.sourceUrl = yahooResult.url || null;

      const diff = old ? yahooResult.price - old : 0;
      const arrow = old ? (diff > 0 ? '↑' : diff < 0 ? '↓' : '=') : '🆕';
      console.log(`  ✅ 최저가: ¥${yahooResult.total.toLocaleString()} (본체¥${yahooResult.price.toLocaleString()} + 送料¥${yahooResult.shipping.toLocaleString()}) (이전: ${old ? '¥'+old.toLocaleString() : '없음'} ${arrow})`);
      updated++;
    } else {
      console.log(`  ❌ 가격 조회 실패 → 미판매 처리`);
      product.japan.priceJPY = null;
      product.japan.shippingJPY = 0;
      product.japan.totalJPY = null;
      product.japan.productTitle = '';
      product.japan.verifiedDate = today;
      product.japan.source = 'yahoo:미발견';
      product.japan.sourceUrl = null;
    }
  }

  await browser.close();

  data.meta.lastUpdated = today;
  data.meta.japanSource = 'shopping.yahoo.co.jp (最安値)';

  writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + '\n');
  console.log(`\n✅ 완료! ${updated}/${data.products.length} 제품 일본 가격 갱신됨.`);
  console.log(`📄 ${DATA_PATH} 저장됨.`);
}

main().catch(err => {
  console.error('❌ 스크립트 실행 실패:', err);
  process.exit(1);
});
