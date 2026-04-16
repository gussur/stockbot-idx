import express from 'express'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const app = express()

app.use(express.json())
app.use(express.static(join(__dirname, 'dist')))

// ==========================================
// SHIELD ANTI-CRASH: Biar Frontend Gak Pernah Layar Putih
// ==========================================
const createSafeFallback = (ticker, errorMsg) => ({
  quote: {
    symbol: ticker,
    longName: errorMsg, // Pesan error akan muncul di tempat nama perusahaan
    price: 0,
    change: 0,
    changePercent: 0,
    regularMarketPrice: 0,
    regularMarketChangePercent: 0
  },
  chart: []
});

// ==========================================
// 1. ENDPOINT SAHAM (PROXY CODETABS -> YAHOO)
// ==========================================
app.get('/stock/:ticker', async (req, res) => {
  const rawTicker = req.params.ticker.toUpperCase();
  const symbol = `${rawTicker}.JK`;

  try {
    const targetQuoteUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbol}`;
    const targetChartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=7d&interval=1d`;

    // Ganti proxy ke CodeTabs (lebih ramah JSON)
    const [quoteRes, chartRes] = await Promise.all([
      fetch(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetQuoteUrl)}`),
      fetch(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetChartUrl)}`)
    ]);

    // Kalau proxy gagal nembus Yahoo
    if (!quoteRes.ok || !chartRes.ok) {
       return res.json(createSafeFallback(symbol, '⚠️ Jalur ke Yahoo ditutup satpam.'));
    }

    const quoteJson = await quoteRes.json();
    const chartJson = await chartRes.json();

    // Validasi kalau Yahoo malah ngasih response aneh/kosong
    if (!quoteJson.quoteResponse || !quoteJson.quoteResponse.result || quoteJson.quoteResponse.result.length === 0) {
       return res.json(createSafeFallback(symbol, '⚠️ Data saham tidak ditemukan di Yahoo.'));
    }

    const quoteData = quoteJson.quoteResponse.result[0];
    const chartResult = chartJson.chart?.result?.[0] || {};

    const formattedQuote = {
      symbol: quoteData.symbol,
      longName: quoteData.longName || quoteData.shortName || rawTicker,
      price: quoteData.regularMarketPrice || 0,
      change: quoteData.regularMarketChange || 0,
      changePercent: quoteData.regularMarketChangePercent || 0,
      regularMarketPrice: quoteData.regularMarketPrice || 0,
      regularMarketChangePercent: quoteData.regularMarketChangePercent || 0
    };

    let formattedChart = [];
    if (chartResult.timestamp && chartResult.indicators?.quote?.[0]) {
      const timestamps = chartResult.timestamp;
      const indicators = chartResult.indicators.quote[0];
      
      for (let i = 0; i < timestamps.length; i++) {
        if (indicators.open[i] !== null) { 
          formattedChart.push({
            date: new Date(timestamps[i] * 1000).toISOString().split('T')[0],
            open: indicators.open[i],
            high: indicators.high[i],
            low: indicators.low[i],
            close: indicators.close[i],
            volume: indicators.volume[i]
          });
        }
      }
      formattedChart = formattedChart.slice(-5);
    }

    res.json({ quote: formattedQuote, chart: formattedChart });
  } catch (e) {
    console.error('Error Fetching:', e.message);
    // KUNCI PERBAIKAN: Jangan pernah kirim res.status(500) lagi.
    // Selalu kirim status 200 dengan format data palsu biar frontend tenang.
    res.json(createSafeFallback(symbol, '⚠️ Server Yahoo lagi error/memblokir kita.'));
  }
})

// ==========================================
// 2. ENDPOINT AI (ANTHROPIC PROXY) - TETAP AMAN
// ==========================================
app.post('/api/v1/messages', async (req, res) => {
  try {
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicApiKey) return res.status(500).json({ error: 'API Key Anthropic belum dipasang!' });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(req.body)
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (e) {
    res.status(500).json({ error: 'Gagal menghubungi server AI.' });
  }
})

// ==========================================
// 3. WILDCARD VITE / REACT
// ==========================================
app.get('*splat', (req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'))
})

app.listen(process.env.PORT || 3000, () => {
  console.log('Server Saham dengan Shield Anti-Crash Online! 🛡️🚀')
})