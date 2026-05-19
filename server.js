import 'dotenv/config'
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
// 2. ENDPOINT ENRICHED — INDIKATOR TEKNIKAL
// (MA, RSI, MACD, Bollinger, ATR, Stochastic)
// ==========================================
app.get('/enriched/:ticker', async (req, res) => {
  const rawTicker = req.params.ticker.toUpperCase();
  const symbol = `IDX:${rawTicker}`;
  const cacheKey = `ENRICHED:${rawTicker}`;
  const ENRICHED_CACHE = 15 * 60 * 1000; // 15 menit — indikator tidak se-volatile harga

  // 1. Cek Cache
  if (cache.has(cacheKey)) {
    const cached = cache.get(cacheKey);
    if (Date.now() - cached.timestamp < ENRICHED_CACHE) {
      console.log(`⚡ Mengambil enriched ${rawTicker} dari CACHE.`);
      return res.json(cached.data);
    }
  }

  try {
    console.log(`📊 Mengambil indikator teknikal ${rawTicker} dari TRADINGVIEW.`);

    const response = await fetch('https://scanner.tradingview.com/indonesia/scan', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Referer': 'https://www.tradingview.com/'
      },
      body: JSON.stringify({
        symbols: { tickers: [symbol] },
        columns: [
          // === Harga & Volume ===
          "close",                    // [0]  Harga terakhir
          "open",                     // [1]  Open hari ini
          "high",                     // [2]  High hari ini
          "low",                      // [3]  Low hari ini
          "volume",                   // [4]  Volume hari ini
          "average_volume",           // [5]  Rata-rata volume (30 hari)
          "average_volume_10d_calc",  // [6]  Rata-rata volume (10 hari)

          // === Moving Average ===
          "SMA20",                    // [7]  Simple MA 20
          "SMA50",                    // [8]  Simple MA 50
          "EMA20",                    // [9]  Exponential MA 20
          "EMA50",                    // [10] Exponential MA 50

          // === Momentum ===
          "RSI",                      // [11] RSI 14
          "RSI[1]",                   // [12] RSI candle sebelumnya (untuk deteksi arah)
          "Stoch.K",                  // [13] Stochastic K
          "Stoch.D",                  // [14] Stochastic D

          // === Trend ===
          "MACD.macd",                // [15] MACD line
          "MACD.signal",              // [16] Signal line
          "MACD.hist",                // [17] Histogram MACD

          // === Volatilitas ===
          "ATR",                      // [18] Average True Range
          "BB.upper",                 // [19] Bollinger Band atas
          "BB.lower",                 // [20] Bollinger Band bawah
          "BB.basis",                 // [21] Bollinger Band tengah (SMA20)

          // === Range & Perubahan ===
          "change",                   // [22] Persentase perubahan hari ini
          "High.1M",                  // [23] High tertinggi 1 bulan
          "Low.1M",                   // [24] Low terendah 1 bulan
          "price_52_week_high",       // [25] High 52 minggu
          "price_52_week_low",        // [26] Low 52 minggu
        ]
      })
    });

    const tvData = await response.json();

    // Ticker tidak ditemukan atau indikator tidak tersedia — fallback ke OHLCV saja
    if (!tvData.data || tvData.data.length === 0) {
      console.log(`⚠️ Indikator tidak tersedia untuk ${rawTicker}, fallback ke OHLCV.`);
      const fallbackRes = await fetch('https://scanner.tradingview.com/indonesia/scan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
        },
        body: JSON.stringify({
          symbols: { tickers: [symbol] },
          columns: ["close", "open", "high", "low", "volume", "change"]
        })
      });
      const fallbackData = await fallbackRes.json();

      if (!fallbackData.data || fallbackData.data.length === 0) {
        return res.status(404).json({
          error: `Saham ${rawTicker} tidak ditemukan di BEI`,
          ticker: rawTicker
        });
      }

      const f = fallbackData.data[0].d;
      const fallbackEnriched = {
        ticker: rawTicker,
        timestamp: new Date().toISOString(),
        _fallback: true,
        close: f[0], open: f[1], high: f[2], low: f[3],
        volume: f[4], change_pct: f[5],
        avg_volume_30d: null, avg_volume_10d: null, volume_ratio: null,
        sma20: null, sma50: null, ema20: null, ema50: null, ma_cross: null,
        rsi: null, rsi_prev: null, stoch_k: null, stoch_d: null,
        macd: null, macd_signal: null, macd_hist: null,
        atr: null, bb_upper: null, bb_lower: null, bb_basis: null,
        bb_width: null, bb_position: null,
        high_1m: null, low_1m: null, high_52w: null, low_52w: null,
        change_1m: null, change_3m: null,
      };

      cache.set(cacheKey, { timestamp: Date.now(), data: fallbackEnriched });
      return res.json(fallbackEnriched);
    }

    const d = tvData.data[0].d;

    // Bantu frontend: flag apakah volume hari ini di atas rata-rata
    const volumeRatio = (d[4] != null && d[5] != null && d[5] > 0)
      ? parseFloat((d[4] / d[5]).toFixed(2))
      : null;

    // Bantu AI: posisi harga relatif terhadap Bollinger Band
    const bbWidth = (d[19] != null && d[20] != null)
      ? parseFloat((d[19] - d[20]).toFixed(0))
      : null;
    const bbPosition = (d[0] != null && d[19] != null && d[20] != null && bbWidth > 0)
      ? parseFloat(((d[0] - d[20]) / bbWidth * 100).toFixed(1))  // 0% = lower, 100% = upper
      : null;

    // Sinyal MA silang sederhana (golden/death cross proxy)
    let maCross = null;
    if (d[7] != null && d[8] != null) {
      maCross = d[7] > d[8] ? 'bullish' : d[7] < d[8] ? 'bearish' : 'neutral';
    }

    const enriched = {
      ticker: rawTicker,
      timestamp: new Date().toISOString(),

      // Harga
      close:          d[0],
      open:           d[1],
      high:           d[2],
      low:            d[3],

      // Volume
      volume:           d[4],
      avg_volume_30d:   d[5],
      avg_volume_10d:   d[6],
      volume_ratio:     volumeRatio,  // > 1.5 = volume tinggi, signal lebih kuat

      // Moving Average
      sma20:  d[7],
      sma50:  d[8],
      ema20:  d[9],
      ema50:  d[10],
      ma_cross: maCross,              // 'bullish' | 'bearish' | 'neutral' | null

      // Momentum
      rsi:          d[11],
      rsi_prev:     d[12],
      stoch_k:      d[13],
      stoch_d:      d[14],

      // Trend
      macd:         d[15],
      macd_signal:  d[16],
      macd_hist:    d[17],

      // Volatilitas
      atr:          d[18],
      bb_upper:     d[19],
      bb_lower:     d[20],
      bb_basis:     d[21],
      bb_width:     bbWidth,
      bb_position:  bbPosition,       // Persentase posisi harga di dalam BB

      // Range & Perubahan
      change_pct:     d[22],
      high_1m:        d[23],
      low_1m:         d[24],
      high_52w:       d[25],
      low_52w:        d[26],
      change_1m:      null,
      change_3m:      null,
    };

    // 3. Cache dan kirim
    cache.set(cacheKey, { timestamp: Date.now(), data: enriched });
    res.json(enriched);

  } catch (e) {
    console.error(`Error enriched ${rawTicker}:`, e.message);
    res.status(500).json({
      error: 'Gagal mengambil indikator teknikal.',
      detail: e.message,
      ticker: rawTicker
    });
  }
})

// ==========================================
// 3. ENDPOINT AI (ANTHROPIC PROXY)
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
