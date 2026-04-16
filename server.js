import express from 'express'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const app = express()

// WAJIB ADA: Biar Express bisa baca pesan (body) yang dikirim dari React ke AI
app.use(express.json())
app.use(express.static(join(__dirname, 'dist')))

// ==========================================
// 1. ENDPOINT SAHAM (FINNHUB API)
// ==========================================
app.get('/stock/:ticker', async (req, res) => {
  try {
    const rawTicker = req.params.ticker.toUpperCase();
    const symbol = `${rawTicker}.JK`;
    const apiKey = process.env.FINNHUB_API_KEY;

    if (!apiKey) return res.status(500).json({ error: 'API Key Finnhub belum dipasang!' });

    const quoteUrl = `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${apiKey}`;
    const profileUrl = `https://finnhub.io/api/v1/stock/profile2?symbol=${symbol}&token=${apiKey}`;
    
    const toDate = Math.floor(Date.now() / 1000);
    const fromDate = toDate - (7 * 24 * 60 * 60); 
    const chartUrl = `https://finnhub.io/api/v1/stock/candle?symbol=${symbol}&resolution=D&from=${fromDate}&to=${toDate}&token=${apiKey}`;

    const [quoteRes, profileRes, chartRes] = await Promise.all([
      fetch(quoteUrl), fetch(profileUrl), fetch(chartUrl)
    ]);

    if (quoteRes.status === 429 || profileRes.status === 429 || chartRes.status === 429) {
      return res.json({
        quote: { symbol: symbol, longName: '⚠️ Kena Limit API Finnhub', price: 0, changePercent: 0, regularMarketPrice: 0 },
        chart: []
      });
    }

    const quoteData = await quoteRes.json();
    const profileData = await profileRes.json();
    const chartData = await chartRes.json();

    const currentPrice = quoteData.c || 0;
    const changePercent = quoteData.dp || 0;
    const companyName = profileData.name || rawTicker; 

    const formattedQuote = {
      symbol: symbol,
      longName: companyName,
      price: currentPrice,
      change: quoteData.d || 0,
      changePercent: changePercent,
      regularMarketPrice: currentPrice,
      regularMarketChangePercent: changePercent
    };

    let formattedChart = [];
    if (chartData.s === 'ok') {
      for (let i = 0; i < chartData.t.length; i++) {
        formattedChart.push({
          date: new Date(chartData.t[i] * 1000).toISOString().split('T')[0],
          open: chartData.o[i], high: chartData.h[i], low: chartData.l[i], close: chartData.c[i], volume: chartData.v[i]
        });
      }
      formattedChart = formattedChart.slice(-5);
    }

    res.json({ quote: formattedQuote, chart: formattedChart });
  } catch (e) {
    console.error('Error Finnhub:', e);
    res.status(500).json({ error: 'Gagal mengambil data saham.' });
  }
})

// ==========================================
// 2. ENDPOINT AI (ANTHROPIC PROXY)
// ==========================================
app.post('/api/v1/messages', async (req, res) => {
  try {
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    
    if (!anthropicApiKey) {
      return res.status(500).json({ error: 'API Key Anthropic belum dipasang di Render!' });
    }

    // Teruskan request dari frontend langsung ke Anthropic
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(req.body) // Kirim riwayat chat ke AI
    });

    const data = await response.json();
    
    // Kembalikan jawaban AI ke frontend
    res.status(response.status).json(data);

  } catch (e) {
    console.error('Error Anthropic API:', e);
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
  console.log('Server Saham & AI Proxy Online! Perjuangan $5 Selesai! 🚀')
})