const whiskies = require('../../data/whiskies.json');

exports.handler = async (event, context) => {
  const { category, sort, search } = event.queryStringParameters || {};

  let results = [...whiskies];

  if (category && category !== 'all') {
    results = results.filter(w => w.category === category);
  }

  if (search) {
    const q = search.toLowerCase();
    results = results.filter(w =>
      w.name.toLowerCase().includes(q) ||
      w.brand.toLowerCase().includes(q)
    );
  }

  if (sort === 'savings-desc') {
    results.sort((a, b) => (b.japanPriceJPY - b.changiPriceSGD * 112) - (a.japanPriceJPY - a.changiPriceSGD * 112));
  } else if (sort === 'name') {
    results.sort((a, b) => a.name.localeCompare(b.name));
  }

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=86400'
    },
    body: JSON.stringify(results)
  };
};
