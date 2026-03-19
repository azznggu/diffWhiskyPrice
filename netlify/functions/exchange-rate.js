exports.handler = async (event, context) => {
  try {
    const response = await fetch('https://api.frankfurter.app/latest?from=SGD&to=JPY');
    if (!response.ok) {
      throw new Error(`Frankfurter API error: ${response.status}`);
    }
    const data = await response.json();

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600'
      },
      body: JSON.stringify({
        rate: data.rates.JPY,
        date: data.date,
        base: 'SGD',
        target: 'JPY'
      })
    };
  } catch (error) {
    // Fallback rate if API is unavailable
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        rate: 112.0,
        date: new Date().toISOString().split('T')[0],
        base: 'SGD',
        target: 'JPY',
        fallback: true,
        error: error.message
      })
    };
  }
};
