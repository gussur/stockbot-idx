import express from 'express'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const app = express()

app.use(express.json())
app.use(express.static(join(__dirname, 'dist')))

// ==========================================
// 🛡️ SISTEM CACHE (MEMORI SERVER)
// ==========================================
const cache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 Menit (bisa diubah sesuai selera)

// ==========================================
// 1. ENDPOINT SAHAM (TRADINGVIEW API)
// ==========================================
app.get('/stock/:ticker', async (req, res) => {
  const rawTicker = req.params.ticker.toUpperCase();
  const symbol = `IDX:${rawTicker}`; // Format wajib TradingView untuk BEI

  // 1. Cek Data di Cache (Biar nggak spam request ke TradingView)
  if (cache.has(symbol)) {
    const cachedData = cache.get(symbol);
    if (Date.now() - cachedData.timestamp < CACHE_DURATION) {
      console.log(`⚡ Mengambil data ${rawTicker} dari CACHE memori.`);
      return res.json(cachedData.data); // Langsung kirim tanpa nembak API
    }
  }

  try {
    // 2. Tembak API Scanner TradingView (Super Stabil & Bebas Blokir)
    console.log(`🌐 Mengambil data baru ${rawTicker} dari TRADINGVIEW.`);
    const response = await fetch('https://scanner.tradingview.com/indonesia/scan', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' // Tiru browser asli
      },
      body: JSON.stringify({
        symbols: { tickers: [symbol] },
        columns: ["name", "description", "close", "change", "open", "high", "low", "volume"]
      })
    });

    const tvData = await response.json();

    // Kalau Ticker nggak ada di BEI
    if (!tvData.data || tvData.data.length === 0) {
      return res.json({
        quote: { symbol: rawTicker, longName: `⚠️ Saham ${rawTicker} tidak ditemukan di BEI`, price: 0, changePercent: 0 },
        chart: []
      });
    }

    // Ekstrak Array Data dari TradingView
    const d = tvData.data[0].d;
    const price = d[2];
    const changePercent = d[3];
    const open = d[4];
    const high = d[5];
    const low = d[6];
    const volume = d[7];
    
    // TradingView cuma ngasih persentase, jadi kita hitung harga absolutnya secara manual
    const previousClose = price / (1 + (changePercent / 100));
    const changeAbs = price - previousClose;

    // Rapikan untuk Frontend
    const formattedQuote = {
      symbol: rawTicker,
      longName: d[1] || rawTicker, // d[1] isinya nama perusahaan (misal: "Bank Central Asia Tbk")
      price: price,
      change: changeAbs,
      changePercent: changePercent,
      regularMarketPrice: price,
      regularMarketChangePercent: changePercent
    };

    // TradingView Scanner ngasih data hari ini (Current Day). 
    // Kita buat 1 candle solid agar AI dan frontend tetap bisa bekerja.
    const today = new Date().toISOString().split('T')[0];
    const formattedChart = [{
      date: today,
      open: open,
      high: high,
      low: low,
      close: price,
      volume: volume
    }];

    const finalData = { quote: formattedQuote, chart: formattedChart };

    // 3. Simpan data baru ke Cache
    cache.set(symbol, {
      timestamp: Date.now(),
      data: finalData
    });

    res.json(finalData);

  } catch (e) {
    console.error('Error TradingView:', e.message);
    res.json({
      quote: { symbol: rawTicker, longName: '⚠️ Gagal terhubung ke server pasar saham.', price: 0, changePercent: 0 },
      chart: []
    });
  }
})

// ==========================================
// 2. ENDPOINT AI (ANTHROPIC PROXY)
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
  console.log('🚀 Final Build Online: TradingView API + Sistem Cache Aktif!');
})