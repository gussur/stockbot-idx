import express from 'express'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const app = express()

app.use(express.static(join(__dirname, 'dist')))

app.get('/stock/:ticker', async (req, res) => {
  try {
    // 1. Format ticker ke .JAK untuk Alpha Vantage
    const ticker = req.params.ticker.toUpperCase();
    const symbol = `${ticker}.JAK`;
    const apiKey = process.env.ALPHA_VANTAGE_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: 'API Key Alpha Vantage belum dipasang di environment Render!' });
    }

    // 2. Siapkan URL untuk Quote (Harga Saat Ini) dan Chart (Data Harian)
    const quoteUrl = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${apiKey}`;
    const chartUrl = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${symbol}&apikey=${apiKey}`;

    // 3. Tarik kedua data secara bersamaan biar cepat
    const [quoteRes, chartRes] = await Promise.all([
      fetch(quoteUrl),
      fetch(chartUrl)
    ]);

    const quoteData = await quoteRes.json();
    const chartData = await chartRes.json();

    // 4. Handle kalau kena limit 25 request/hari dari Alpha Vantage
    if ((quoteData.Information && quoteData.Information.includes('rate limit')) ||
        (chartData.Information && chartData.Information.includes('rate limit'))) {
      return res.status(429).json({ error: 'Limit API Alpha Vantage habis (Maksimal 25 request/hari).' });
    }

    // 5. Rapikan data Quote
    const globalQuote = quoteData['Global Quote'] || {};
    const formattedQuote = {
      symbol: globalQuote['01. symbol'],
      price: parseFloat(globalQuote['05. price']),
      change: parseFloat(globalQuote['09. change']),
      changePercent: globalQuote['10. change percent'],
      // Tambahan variabel biar nggak error kalau frontend kamu nyari variabel bawaan Yahoo
      regularMarketPrice: parseFloat(globalQuote['05. price']), 
      regularMarketChangePercent: parseFloat(globalQuote['10. change percent'])
    };

    // 6. Rapikan data Chart (Ambil 5 hari terakhir)
    const timeSeries = chartData['Time Series (Daily)'] || {};
    // Ambil 5 tanggal terbaru
    const latest5Days = Object.keys(timeSeries).slice(0, 5); 
    
    const formattedChart = latest5Days.map(date => {
      return {
        date: date,
        open: parseFloat(timeSeries[date]['1. open']),
        high: parseFloat(timeSeries[date]['2. high']),
        low: parseFloat(timeSeries[date]['3. low']),
        close: parseFloat(timeSeries[date]['4. close']),
        volume: parseInt(timeSeries[date]['5. volume'])
      }
    }).reverse(); // Di-reverse agar urutan harinya dari terlama -> terbaru (standar chart)

    // 7. Kirim data ke Frontend
    res.json({ quote: formattedQuote, chart: formattedChart });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Gagal mengambil data dari server saham.' });
  }
})

// Wildcard untuk routing Vite/SPA
app.get('*splat', (req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'))
})

app.listen(process.env.PORT || 3000, () => {
  console.log('Server jalan tanpa bayang-bayang error Yahoo Finance 🚀');
})