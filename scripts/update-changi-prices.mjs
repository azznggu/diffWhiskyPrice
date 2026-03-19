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

// 브랜드별 iShopChangi URL 매핑
const BRAND_SLUGS = {
  'Macallan': 'macallan',
  'Lagavulin': 'lagavulin',
  'Laphroaig': 'laphroaig',
  'Ardbeg': 'ardbeg',
  'Redbreast': 'redbreast',
  'Aultmore': 'aultmore',
  'Bowmore': 'bowmore',
  'Glenfiddich': 'glenfiddich',
  'Glenlivet': 'glenlivet',
  'Highland Park': 'highland-park',
  'Talisker': 'talisker',
  'Oban': 'oban',
};

// 제품 매칭을 위한 키워드 (iShopChangi 제품명에서 매칭)
const PRODUCT_MATCHERS = {
  'macallan-12dc': [/double\s*cask.*12|12.*double\s*cask/i],
  'macallan-12so': [/sherry\s*oak.*12|12.*sherry\s*oak/i],
  'macallan-18dc': [/double\s*cask.*18|18.*double\s*cask/i],
  'lagavulin-16': [/lagavulin.*16/i],
  'lagavulin-8': [/lagavulin.*8\s*(year|yo)/i],
  'laphroaig-10': [/laphroaig.*10/i],
  'laphroaig-qc': [/quarter\s*cask/i],
  'ardbeg-10': [/ardbeg.*10/i, /ardbeg\s+ten/i],
  'ardbeg-uigeadail': [/uigeadail/i],
  'redbreast-12': [/redbreast.*12/i],
  'aultmore-12': [/aultmore.*12/i],
  'bowmore-12': [/bowmore.*12/i],
  'glenfiddich-12': [/glenfiddich.*12/i],
  'glenlivet-12': [/glenlivet.*12/i],
  'highland-park-12': [/highland\s*park.*12/i],
  'talisker-10': [/talisker.*10/i],
  'oban-14': [/oban.*14/i],
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function extractVolume(name) {
  const m = name.match(/(\d+)\s*ml/i);
  if (m) return parseInt(m[1]);
  const l = name.match(/(\d+(?:\.\d+)?)\s*l(?:itre)?/i);
  if (l) return Math.round(parseFloat(l[1]) * 1000);
  return null;
}

async function scrapeBrandPage(page, brandSlug) {
  const url = `https://www.ishopchangi.com/en/brand/${brandSlug}/view-all?cmode=tr`;
  console.log(`\n🌐 ${brandSlug}: ${url}`);

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // SPA 렌더링 대기 - 제품 타일이 로드될 때까지
    await page.waitForSelector('.product-tile-medium-wrapper, .product-listing, [class*="product"]', { timeout: 15000 }).catch(() => {});
    // 추가 대기 (가격 렌더링)
    await sleep(3000);

    // "Load More" 버튼이 있으면 클릭하여 모든 제품 로드
    let loadMoreClicks = 0;
    while (loadMoreClicks < 5) {
      const loadMore = await page.$('button:has-text("LOAD MORE"), button:has-text("Load More"), [class*="load-more"]');
      if (!loadMore) break;
      await loadMore.click();
      await sleep(2000);
      loadMoreClicks++;
    }

    // 제품 정보 추출 (DOM에서)
    const products = await page.evaluate(() => {
      const results = [];

      // 방법 1: product tile에서 추출
      const tiles = document.querySelectorAll('.product-tile-medium-wrapper, [class*="product-tile"], [class*="ProductTile"]');
      for (const tile of tiles) {
        const nameEl = tile.querySelector('a[data-linkname], [class*="product-name"], [class*="productName"], h3, h4');
        const name = nameEl?.textContent?.trim() || '';
        const text = tile.textContent || '';

        // 가격 추출: S$XXX.XX 패턴
        const priceMatches = text.match(/S\$\s*([\d,]+(?:\.\d{2})?)/g);
        let price = null;
        if (priceMatches) {
          // 여러 가격이 있으면 (할인가/정가) 첫 번째가 보통 할인가
          const prices = priceMatches.map(p => parseFloat(p.replace('S$', '').replace(/,/g, '').trim()));
          price = Math.min(...prices); // 최저가 사용
        }

        if (name && price) {
          results.push({ name, price });
        }
      }

      // 방법 2: tiles가 비었으면 전체 페이지에서 제품 패턴 추출
      if (results.length === 0) {
        const allLinks = document.querySelectorAll('a[href*="/product/"]');
        for (const link of allLinks) {
          const container = link.closest('[class*="product"], [class*="tile"], li, article') || link.parentElement?.parentElement;
          if (!container) continue;
          const name = link.textContent?.trim() || '';
          const text = container.textContent || '';
          const priceMatch = text.match(/S\$\s*([\d,]+(?:\.\d{2})?)/);
          const price = priceMatch ? parseFloat(priceMatch[1].replace(/,/g, '')) : null;
          if (name && price && name.length > 5) {
            results.push({ name, price });
          }
        }
      }

      return results;
    });

    console.log(`  📦 ${products.length}개 제품 발견`);
    products.forEach(p => console.log(`     ${p.name} → S$${p.price}`));
    return products;
  } catch (err) {
    console.error(`  ❌ ${brandSlug} 스크래핑 실패: ${err.message}`);
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

  // 쿠키 배너 등 자동 닫기
  page.on('dialog', dialog => dialog.dismiss());

  // 브랜드별로 스크래핑
  const uniqueBrands = [...new Set(data.products.map(p => p.brand))];
  const allScrapedProducts = {};

  for (const brand of uniqueBrands) {
    const slug = BRAND_SLUGS[brand];
    if (!slug) {
      console.log(`⏭️  ${brand}: 브랜드 슬러그 미등록, 스킵`);
      continue;
    }

    const scraped = await scrapeBrandPage(page, slug);
    allScrapedProducts[brand] = scraped;
    await sleep(2000); // 요청 간 딜레이
  }

  // 검색 폴백: 브랜드 페이지에서 못 찾은 제품은 검색으로 시도
  for (const product of data.products) {
    const brandProducts = allScrapedProducts[product.brand] || [];
    const matchers = PRODUCT_MATCHERS[product.id];
    if (!matchers) continue;

    let matched = null;
    for (const item of brandProducts) {
      if (matchers.some(re => re.test(item.name))) {
        matched = item;
        break;
      }
    }

    if (!matched) {
      // 검색 폴백
      console.log(`\n🔍 검색 폴백: ${product.name}`);
      const searchUrl = `https://www.ishopchangi.com/en/search?q=${encodeURIComponent(product.name)}&cmode=tr`;
      try {
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(5000);
        const searchResults = await page.evaluate(() => {
          const results = [];
          const tiles = document.querySelectorAll('[class*="product-tile"], [class*="ProductTile"], a[href*="/product/"]');
          for (const tile of tiles) {
            const container = tile.closest('[class*="product"], [class*="tile"], li, article') || tile.parentElement?.parentElement || tile;
            const name = (tile.querySelector('[class*="name"], h3, h4')?.textContent || tile.textContent || '').trim();
            const text = container.textContent || '';
            const priceMatch = text.match(/S\$\s*([\d,]+(?:\.\d{2})?)/);
            const price = priceMatch ? parseFloat(priceMatch[1].replace(/,/g, '')) : null;
            if (name && price && name.length > 5) results.push({ name, price });
          }
          return results;
        });

        for (const item of searchResults) {
          if (matchers.some(re => re.test(item.name))) {
            matched = item;
            console.log(`  ✅ 검색에서 발견: ${item.name} → S$${item.price}`);
            break;
          }
        }
      } catch (err) {
        console.log(`  ⚠️ 검색 실패: ${err.message}`);
      }
      await sleep(2000);
    }

    if (matched) {
      const oldPrice = product.changi.priceSGD;
      const volume = extractVolume(matched.name) || product.changi.volumeML;
      product.changi.priceSGD = matched.price;
      product.changi.volumeML = volume;
      product.changi.available = true;
      product.changi.verifiedDate = today;

      const diff = oldPrice ? (matched.price - oldPrice).toFixed(2) : 'NEW';
      const arrow = oldPrice ? (matched.price > oldPrice ? '↑' : matched.price < oldPrice ? '↓' : '=') : '🆕';
      console.log(`  ✅ ${product.nameKR}: S$${matched.price} (이전: ${oldPrice ? 'S$'+oldPrice : '없음'} ${arrow})`);
      updated++;
    } else {
      console.log(`  ⚠️ ${product.nameKR}: 매칭 실패, 기존값 유지`);
      // 매칭 못 하면 available 상태는 변경하지 않음
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
