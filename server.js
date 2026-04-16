import express from 'express'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const app = express()

app.use(express.json())
app.use(express.static(join(__dirname, 'dist')))

// ==========================================
// 1. ENDPOINT SAHAM (BYPASS YAHOO FINANCE)
// ==========================================
app.get('/stock/:ticker', async (req, res) => {
  try {
    const rawTicker = req.params.ticker.toUpperCase();
    const symbol = `${rawTicker}.JK`;

    // Target URL API resmi Yahoo Finance
    const targetQuoteUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbol}`;
    const targetChartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=7d&interval=1d`;

    // Gunakan AllOrigins untuk membungkus request agar tidak diblokir Yahoo
    const [quoteRes, chartRes] = await Promise.all([
      fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(targetQuoteUrl)}`),
      fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(targetChartUrl)}`)
    ]);

    const quoteJson = await quoteRes.json();
    const chartJson = await chartRes.json();

    const quoteData = quoteJson.quoteResponse.result[0];
    const chartResult = chartJson.chart.result[0];

    if (!quoteData || !chartResult) {
       return res.json({ error: 'Saham tidak ditemukan di Yahoo Finance' });
    }

    // Rapikan Data Harga Saat Ini
    const formattedQuote = {
      symbol: quoteData.symbol,
      longName: quoteData.longName || quoteData.shortName || rawTicker,
      price: quoteData.regularMarketPrice,
      change: quoteData.regularMarketChange,
      changePercent: quoteData.regularMarketChangePercent,
      regularMarketPrice: quoteData.regularMarketPrice,
      regularMarketChangePercent: quoteData.regularMarketChangePercent
    };

    // Rapikan Data Chart Historis
    let formattedChart = [];
    const timestamps = chartResult.timestamp;
    const indicators = chartResult.indicators.quote[0];
    
    if (timestamps && indicators) {
      for (let i = 0; i < timestamps.length; i++) {
        // Abaikan data null (misal saat hari libur bursa)
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
      formattedChart = formattedChart.slice(-5); // Ambil 5 hari bursa terakhir
    }

    res.json({ quote: formattedQuote, chart: formattedChart });
  } catch (e) {
    console.error('Error Ambil Data:', e);
    res.status(500).json({ error: 'Gagal mengambil data saham.' });
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

app.get('*splat', (req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'))
})

app.listen(process.env.PORT || 3000, () => {
  console.log('Server Saham Yahoo Proxy & AI Online! Selesai sudah penderitaan ini! 🚀')
})