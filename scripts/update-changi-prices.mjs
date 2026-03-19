/**
 * 창이공항 면세점 위스키 가격 자동 갱신 스크립트
 * Playwright로 iShopChangi.com SPA를 렌더링하여 가격을 추출합니다.
 * GitHub Action 또는 로컬에서 실행 가능.
 *
 * Usage: node scripts/update-changi-prices.mjs
 * 사전 요구: npx playwright install chromium
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = resolve(__dirname, '../data/whiskies.json');

// 브랜드별 iShopChangi URL (일부는 Diageo 하위 경로)
const BRAND_URLS = {
  'Macallan':      '/en/brand/macallan/view-all?cmode=tr',
  'Lagavulin':     '/en/brand/diageo/our-brands/malts/lagavulin?cmode=tr',
  'Laphroaig':     '/en/brand/laphroaig/view-all?cmode=tr',
  'Ardbeg':        '/en/brand/ardbeg/view-all?cmode=tr',
  'Redbreast':     '/en/brand/redbreast/view-all?cmode=tr',
  'Aultmore':      '/en/brand/aultmore/view-all?cmode=tr',
  'Bowmore':       '/en/brand/bowmore/view-all?cmode=tr',
  'Glenfiddich':   '/en/brand/glenfiddich/view-all?cmode=tr',
  'Highland Park': '/en/brand/highland-park/view-all?cmode=tr',
  'Talisker':      '/en/brand/diageo/our-brands/malts/talisker?cmode=tr',
  'Oban':          '/en/brand/oban/view-all?cmode=tr',
};

// 제품 매칭을 위한 키워드 (iShopChangi 실제 제품명 기준)
const PRODUCT_MATCHERS = {
  'macallan-12cc':       [/macallan.*colour.*collection.*12|macallan.*12.*colour/i],
  'macallan-18cc':       [/macallan.*colour.*collection.*18|macallan.*18.*colour/i],
  'lagavulin-16':        [/lagavulin.*16/i],
  'lagavulin-10':        [/lagavulin.*10\s*(year|yo)/i],
  'laphroaig-10':        [/laphroaig.*10\s*yo|laphroaig.*10\s*year/i],
  'laphroaig-12':        [/laphroaig.*12\s*(year|yo)|laphroaig\s+12/i],
  'ardbeg-10':           [/ardbeg.*10\s*(year|yo)|ardbeg\s+10\b/i],
  'redbreast-12':        [/redbreast.*12/i],
  'aultmore-12':         [/aultmore.*12/i],
  'bowmore-11':          [/bowmore.*11\s*yo|bowmore.*11.*sherry/i],
  'glenfiddich-perpetual': [/glenfiddich.*perpetual.*vat\s*1\b|glenfiddich.*vat\s*1\s/i],
  'highland-park-14':    [/highland\s*park.*14|highland\s*park.*land.*orkney/i],
  'talisker-10':         [/talisker.*10\s*yo|talisker.*10\b/i],
  'oban-14':             [/oban.*14/i],
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function extractVolume(name) {
  const m = name.match(/(\d+)\s*ml/i);
  if (m) return parseInt(m[1]);
  const l = name.match(/(\d+(?:\.\d+)?)\s*l(?:itre)?/i);
  if (l) return Math.round(parseFloat(l[1]) * 1000);
  return null;
}

async function scrapeBrandPage(page, brand, brandPath) {
  const url = `https://www.ishopchangi.com${brandPath}`;
  console.log(`\n🌐 ${brand}: ${url}`);

  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // 404 체크
    if (response && response.status() === 404) {
      console.log(`  ❌ 404 Not Found`);
      return [];
    }

    // SPA 렌더링 대기
    await page.waitForSelector('.product-tile-medium-wrapper, .product-listing, [class*="product-tile"]', { timeout: 15000 }).catch(() => {});
    await sleep(3000);

    // "Load More" 버튼 클릭
    let loadMoreClicks = 0;
    while (loadMoreClicks < 5) {
      const loadMore = await page.$('button:has-text("LOAD MORE"), button:has-text("Load More"), [class*="load-more"]');
      if (!loadMore) break;
      await loadMore.click();
      await sleep(2000);
      loadMoreClicks++;
    }

    // 제품 정보 추출
    const products = await page.evaluate(() => {
      const results = [];
      const tiles = document.querySelectorAll('.product-tile-medium-wrapper, [class*="product-tile"], [class*="ProductTile"]');
      for (const tile of tiles) {
        const text = tile.textContent || '';

        // 가격 추출: S$XXX.XX 패턴
        const priceMatches = text.match(/S\$\s*([\d,]+(?:\.\d{2})?)/g);
        let price = null;
        if (priceMatches) {
          const prices = priceMatches.map(p => parseFloat(p.replace('S$', '').replace(/,/g, '').trim()));
          price = Math.min(...prices);
        }

        if (price) {
          results.push({ name: text.trim().substring(0, 200), price });
        }
      }
      return results;
    });

    console.log(`  📦 ${products.length}개 제품 발견`);
    products.forEach(p => console.log(`     ${p.name.substring(0, 80)} → S$${p.price}`));
    return products;
  } catch (err) {
    console.error(`  ❌ ${brand} 스크래핑 실패: ${err.message}`);
    return [];
  }
}

async function main() {
  console.log('🚀 창이공항 면세점 가격 자동 갱신 시작...\n');

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
    locale: 'en-SG',
  });

  const page = await context.newPage();
  page.on('dialog', dialog => dialog.dismiss());

  // 브랜드별 스크래핑
  const uniqueBrands = [...new Set(data.products.map(p => p.brand))];
  const allScrapedProducts = {};

  for (const brand of uniqueBrands) {
    const brandPath = BRAND_URLS[brand];
    if (!brandPath) {
      console.log(`⏭️  ${brand}: URL 미등록, 스킵`);
      continue;
    }

    const scraped = await scrapeBrandPage(page, brand, brandPath);
    allScrapedProducts[brand] = scraped;
    await sleep(2000);
  }

  // 제품 매칭
  for (const product of data.products) {
    const brandProducts = allScrapedProducts[product.brand] || [];
    const matchers = PRODUCT_MATCHERS[product.id];
    if (!matchers) {
      console.log(`⏭️  ${product.id}: 매처 미등록, 스킵`);
      product.changi.priceSGD = null;
      product.changi.available = false;
      product.changi.verifiedDate = today;
      continue;
    }

    let matched = null;
    for (const item of brandProducts) {
      if (matchers.some(re => re.test(item.name))) {
        matched = item;
        break;
      }
    }

    if (matched) {
      const oldPrice = product.changi.priceSGD;
      const volume = extractVolume(matched.name) || product.changi.volumeML;
      product.changi.priceSGD = matched.price;
      product.changi.volumeML = volume;
      product.changi.available = true;
      product.changi.verifiedDate = today;
      delete product.changi.notes;

      const arrow = oldPrice ? (matched.price > oldPrice ? '↑' : matched.price < oldPrice ? '↓' : '=') : '🆕';
      console.log(`  ✅ ${product.nameKR}: S$${matched.price} ${volume}ml (이전: ${oldPrice ? 'S$'+oldPrice : '없음'} ${arrow})`);
      updated++;
    } else {
      product.changi.priceSGD = null;
      product.changi.available = false;
      product.changi.verifiedDate = today;
      product.changi.notes = '자동 스크래핑 미발견';
      console.log(`  ❌ ${product.nameKR}: 매칭 실패 → 미판매 처리`);
    }
  }

  await browser.close();

  data.meta.lastUpdated = today;
  data.meta.changiSource = 'iShopChangi.com (Traveller mode, auto-scraped)';

  writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + '\n');
  console.log(`\n✅ 완료! ${updated}/${data.products.length} 제품 창이 가격 갱신됨.`);
  console.log(`📄 ${DATA_PATH} 저장됨.`);
}

main().catch(err => {
  console.error('❌ 스크립트 실행 실패:', err);
  process.exit(1);
});
