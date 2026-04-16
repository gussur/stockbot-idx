import express from 'express'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const app = express()

app.use(express.static(join(__dirname, 'dist')))

app.get('/stock/:ticker', async (req, res) => {
  try {
    // 1. Setup ticker pakai .JK untuk Finnhub (sama kayak Yahoo)
    const rawTicker = req.params.ticker.toUpperCase();
    const symbol = `${rawTicker}.JK`;
    const apiKey = process.env.FINNHUB_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: 'API Key Finnhub belum dipasang!' });
    }

    // 2. Siapkan URL Finnhub (Quote: Harga saat ini, Profile: Nama Perusahaan, Candle: Chart Harian)
    const quoteUrl = `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${apiKey}`;
    const profileUrl = `https://finnhub.io/api/v1/stock/profile2?symbol=${symbol}&token=${apiKey}`;
    
    // Setup waktu untuk Chart (ambil 7 hari terakhir dalam detik/UNIX timestamp)
    const toDate = Math.floor(Date.now() / 1000);
    const fromDate = toDate - (7 * 24 * 60 * 60); 
    const chartUrl = `https://finnhub.io/api/v1/stock/candle?symbol=${symbol}&resolution=D&from=${fromDate}&to=${toDate}&token=${apiKey}`;

    // 3. Tarik semua data berbarengan
    const [quoteRes, profileRes, chartRes] = await Promise.all([
      fetch(quoteUrl),
      fetch(profileUrl),
      fetch(chartUrl)
    ]);

    // 4. Handle Limit (Finnhub mengembalikan status 429 kalau kena limit 60/menit)
    if (quoteRes.status === 429 || profileRes.status === 429 || chartRes.status === 429) {
      return res.json({
        quote: { 
          symbol: symbol, 
          longName: '⚠️ Kena Limit API (Tunggu 1 menit lagi)', 
          price: 0, 
          changePercent: 0,
          regularMarketPrice: 0
        },
        chart: []
      });
    }

    const quoteData = await quoteRes.json();
    const profileData = await profileRes.json();
    const chartData = await chartRes.json();

    // 5. Rapikan Data Quote & Profile
    const currentPrice = quoteData.c || 0;
    const changePercent = quoteData.dp || 0;
    // Kalau Finnhub nggak nemu nama panjangnya, fallback ke kodenya (misal: BBCA)
    const companyName = profileData.name || rawTicker; 

    const formattedQuote = {
      symbol: symbol,
      longName: companyName, // Ini yang tadi bikin frontend kamu crash
      price: currentPrice,
      change: quoteData.d || 0,
      changePercent: changePercent,
      regularMarketPrice: currentPrice,
      regularMarketChangePercent: changePercent
    };

    // 6. Rapikan Data Chart (Candle)
    let formattedChart = [];
    if (chartData.s === 'ok') {
      // Loop untuk menyatukan array data dari Finnhub menjadi object
      for (let i = 0; i < chartData.t.length; i++) {
        formattedChart.push({
          date: new Date(chartData.t[i] * 1000).toISOString().split('T')[0],
          open: chartData.o[i],
          high: chartData.h[i],
          low: chartData.l[i],
          close: chartData.c[i],
          volume: chartData.v[i]
        });
      }
      // Ambil 5 hari paling akhir
      formattedChart = formattedChart.slice(-5);
    }

    // 7. Lempar ke Frontend
    res.json({ quote: formattedQuote, chart: formattedChart });

  } catch (e) {
    console.error('Error server:', e);
    res.status(500).json({ error: 'Gagal mengambil data dari Finnhub.' });
  }
})

// Wildcard untuk routing Vite/SPA (pakai *splat biar nggak error kayak tadi)
app.get('*splat', (req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'))
})

app.listen(process.env.PORT || 3000, () => {
  console.log('Server Finnhub Online! Limit 60 request/menit 🚀');
})