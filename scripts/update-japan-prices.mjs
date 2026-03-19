/**
 * 일본 시장 위스키 최저가 자동 갱신 스크립트
 * Playwright로 Yahoo Shopping 검색 결과를 스크래핑하여 최저가를 수집합니다.
 * 검색어에 "700ml" 포함 + 가격 하한 ¥2,500으로 미니어처/샘플 제외
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
 * Yahoo Shopping 검색 → 가격 추출 (Playwright)
 */
async function searchYahoo(page, searchTerm) {
  const fullTerm = `${searchTerm} 700ml`;
  const url = `https://shopping.yahoo.co.jp/search?p=${encodeURIComponent(fullTerm)}&X=2&sort=%2Bprice`;
  console.log(`    [Yahoo] "${fullTerm}"`);

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForSelector('[class*="Product"], [class*="item"], [class*="mdSearchResult"]', { timeout: 10000 }).catch(() => {});
    await sleep(2000);

    const prices = await page.evaluate((min) => {
      const results = [];

      // 검색 결과 아이템 단위로 처리
      const items = document.querySelectorAll('[class*="ProductList"] li, [class*="mdSearchResult"] li, [class*="item-card"], [class*="Product_product"]');
      for (const item of items) {
        const text = item.textContent || '';
        // 미니어처/샘플 제외
        if (/(?:50|100|200)\s*ml/i.test(text) && !/700\s*ml/i.test(text)) continue;
        if (/ミニチュア|ミニボトル|サンプル|お試し/i.test(text)) continue;

        const m = text.match(/([\d,]+)\s*円/) || text.match(/¥\s*([\d,]+)/);
        if (m) {
          const p = parseInt(m[1].replace(/,/g, ''));
          if (p >= min) results.push(p);
        }
      }

      // 폴백: 가격 요소에서 직접 추출
      if (results.length === 0) {
        const priceEls = document.querySelectorAll('[class*="Price"], [class*="price"]');
        for (const el of priceEls) {
          const text = el.textContent || '';
          const m = text.match(/([\d,]+)\s*円/) || text.match(/¥\s*([\d,]+)/);
          if (m) {
            const p = parseInt(m[1].replace(/,/g, ''));
            if (p >= min) results.push(p);
          }
        }
      }

      return results;
    }, MIN_PRICE);

    if (prices.length > 0) {
      const min = Math.min(...prices);
      console.log(`      → ¥${min.toLocaleString()} (${prices.length}건 중 최저가)`);
      return min;
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

    const yahooPrice = await searchYahoo(page, term);
    await sleep(DELAY_MS);

    if (yahooPrice !== null) {
      const old = product.japan.priceJPY;
      product.japan.priceJPY = yahooPrice;
      product.japan.verifiedDate = today;
      product.japan.source = `yahoo:¥${yahooPrice.toLocaleString()}`;

      const diff = old ? yahooPrice - old : 0;
      const arrow = old ? (diff > 0 ? '↑' : diff < 0 ? '↓' : '=') : '🆕';
      console.log(`  ✅ 최저가: ¥${yahooPrice.toLocaleString()} (이전: ${old ? '¥'+old.toLocaleString() : '없음'} ${arrow})`);
      updated++;
    } else {
      console.log(`  ❌ 가격 조회 실패`);
      product.japan.verifiedDate = '';
      product.japan.source = 'failed';
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
