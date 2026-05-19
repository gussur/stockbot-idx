import { useState, useRef } from "react";

const SYSTEM_PROMPT = `Kamu adalah analis saham profesional IDX (Bursa Efek Indonesia) yang spesialis intraday trading.

Kamu akan diberikan data teknikal LENGKAP dan REAL dari TradingView untuk saham IDX.
Gunakan SEMUA data yang tersedia untuk analisis yang akurat dan komprehensif.

1. MOMENTUM: Tentukan momentum saat ini (BULLISH/BEARISH/SIDEWAYS) berdasarkan:
   - RSI aktual (overbought >70, oversold <30) — data sudah tersedia, JANGAN estimasi
   - MACD aktual (histogram positif/negatif, cross signal) — data sudah tersedia
   - Posisi harga vs MA20 dan MA50
   - Volume ratio vs rata-rata (>1.5x = volume tinggi, konfirmasi signal lebih kuat)
   - Posisi harga di Bollinger Band (bb_position: 0%=lower band, 100%=upper band)

2. SUPPORT & RESISTANCE:
   - Gunakan high/low 1 bulan dan 52 minggu sebagai referensi utama
   - Hitung pivot, R1, R2, S1, S2 dari data OHLC yang tersedia
   - Bollinger Band upper/lower juga bisa jadi S/R dinamis

3. SINYAL INTRADAY:
   - Sinyal: BUY / SELL / WAIT berdasarkan kombinasi indikator
   - Entry price yang disarankan
   - Target profit (TP) dan Stop loss (SL) berdasarkan ATR atau S/R terdekat
   - Risk/Reward ratio minimal 1:2

4. RINGKASAN: Narasi 2-3 kalimat berdasarkan data teknikal yang ada.

PENTING: Data teknikal sudah tersedia lengkap. Jangan pernah menyebut "data terbatas" atau "estimasi RSI".
Gunakan nilai aktual dari data yang diberikan.

Respond HANYA dalam format JSON berikut tanpa markdown, tanpa backtick:
{
  "ticker": "KODE.JK",
  "companyName": "Nama Perusahaan",
  "lastPrice": 0000,
  "priceChange": "+/-XX",
  "priceChangePct": "+/-X.XX%",
  "momentum": "BULLISH",
  "momentumStrength": "KUAT",
  "rsi": 00,
  "macd": "BULLISH_CROSS",
  "volume": "TINGGI",
  "pivot": 0000,
  "r1": 0000,
  "r2": 0000,
  "s1": 0000,
  "s2": 0000,
  "signal": "BUY",
  "entry": 0000,
  "tp": 0000,
  "sl": 0000,
  "rrRatio": "1:2",
  "summary": "Narasi singkat kondisi saham...",
  "lastUpdated": "HH:MM WIB"
}`;

const POPULAR_STOCKS = ["BBCA", "BBRI", "TLKM", "ASII", "BMRI", "GOTO", "BYAN", "UNVR", "ICBP", "ADRO"];

// Helper: format nilai indikator — tampilkan "N/A" kalau null
const fmt = (val, decimals = 2) =>
  val != null ? (typeof val === "number" ? val.toFixed(decimals) : val) : "N/A";

export default function App() {
  const [ticker, setTicker] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState([]);
  const inputRef = useRef(null);

  const analyze = async (code) => {
    const stockCode = (code || ticker).toUpperCase().trim();
    if (!stockCode) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      // ─── Fetch paralel: harga dasar + indikator teknikal ───────────────────
      const [stockRes, enrichedRes] = await Promise.all([
        fetch(`/stock/${stockCode}`),
        fetch(`/enriched/${stockCode}`)
      ]);

      const stockData  = await stockRes.json();
      const enriched   = await enrichedRes.json();
      const q          = stockData.quote;

      // ─── Cek apakah enriched berhasil ──────────────────────────────────────
      const hasEnriched = enriched && !enriched.error;

      // ─── Volume interpretation ──────────────────────────────────────────────
      let volumeLabel = "N/A";
      if (hasEnriched && enriched.volume_ratio != null) {
        volumeLabel = enriched.volume_ratio >= 1.5
          ? `TINGGI (${enriched.volume_ratio}x rata-rata)`
          : enriched.volume_ratio >= 0.8
          ? `NORMAL (${enriched.volume_ratio}x rata-rata)`
          : `RENDAH (${enriched.volume_ratio}x rata-rata)`;
      }

      // ─── MACD interpretation ────────────────────────────────────────────────
      let macdLabel = "N/A";
      if (hasEnriched && enriched.macd != null && enriched.macd_signal != null) {
        const hist = enriched.macd_hist;
        macdLabel = hist > 0
          ? `BULLISH (hist: +${fmt(hist)})`
          : hist < 0
          ? `BEARISH (hist: ${fmt(hist)})`
          : "NEUTRAL";
      }

      // ─── Stochastic interpretation ──────────────────────────────────────────
      let stochLabel = "N/A";
      if (hasEnriched && enriched.stoch_k != null) {
        const k = enriched.stoch_k;
        stochLabel = k > 80
          ? `OVERBOUGHT (K:${fmt(k, 1)})`
          : k < 20
          ? `OVERSOLD (K:${fmt(k, 1)})`
          : `NEUTRAL (K:${fmt(k, 1)})`;
      }

      // ─── Bollinger Band interpretation ─────────────────────────────────────
      let bbLabel = "N/A";
      if (hasEnriched && enriched.bb_position != null) {
        const pos = enriched.bb_position;
        bbLabel = pos >= 80
          ? `MENDEKATI UPPER BAND (${pos}%)`
          : pos <= 20
          ? `MENDEKATI LOWER BAND (${pos}%)`
          : `TENGAH BAND (${pos}%)`;
      }

      // ─── MA trend ──────────────────────────────────────────────────────────
      let maLabel = "N/A";
      if (hasEnriched && enriched.ma_cross) {
        const priceVsMa20 = enriched.close > enriched.sma20 ? "di atas" : "di bawah";
        const priceVsMa50 = enriched.close > enriched.sma50 ? "di atas" : "di bawah";
        maLabel = `SMA20: ${fmt(enriched.sma20, 0)} | SMA50: ${fmt(enriched.sma50, 0)} | Harga ${priceVsMa20} MA20 dan ${priceVsMa50} MA50 | Cross: ${enriched.ma_cross.toUpperCase()}`;
      }

      // ─── Susun prompt ke Claude ─────────────────────────────────────────────
      const prompt = `Analisis saham ${stockCode} (${q.longName || stockCode}) di IDX berdasarkan data teknikal real berikut:

=== DATA HARGA ===
- Harga saat ini : ${q.regularMarketPrice}
- Open hari ini  : ${hasEnriched ? fmt(enriched.open, 0) : "N/A"}
- High hari ini  : ${hasEnriched ? fmt(enriched.high, 0) : "N/A"}
- Low hari ini   : ${hasEnriched ? fmt(enriched.low, 0) : "N/A"}
- Perubahan      : ${q.changePercent >= 0 ? "+" : ""}${fmt(q.changePercent)}%

=== INDIKATOR TEKNIKAL ===
- RSI (14)       : ${hasEnriched ? fmt(enriched.rsi, 1) : "N/A"}${enriched.rsi > 70 ? " ⚠ OVERBOUGHT" : enriched.rsi < 30 ? " ⚠ OVERSOLD" : ""}
- MACD           : ${macdLabel}
- Stochastic     : ${stochLabel}
- Bollinger Band : ${bbLabel}  (Upper: ${fmt(enriched.bb_upper, 0)} | Lower: ${fmt(enriched.bb_lower, 0)} | Width: ${fmt(enriched.bb_width, 0)})
- Moving Average : ${maLabel}
- ATR            : ${hasEnriched ? fmt(enriched.atr, 0) : "N/A"} (volatilitas harian)

=== VOLUME ===
- Volume hari ini  : ${hasEnriched ? enriched.volume?.toLocaleString("id-ID") : "N/A"}
- Rata-rata 30 hari: ${hasEnriched ? enriched.avg_volume_30d?.toLocaleString("id-ID") : "N/A"}
- Rata-rata 10 hari: ${hasEnriched ? enriched.avg_volume_10d?.toLocaleString("id-ID") : "N/A"}
- Volume ratio     : ${volumeLabel}

=== RANGE REFERENSI ===
- High 1 bulan   : ${hasEnriched ? fmt(enriched.high_1m, 0) : "N/A"}
- Low 1 bulan    : ${hasEnriched ? fmt(enriched.low_1m, 0) : "N/A"}
- High 52 minggu : ${hasEnriched ? fmt(enriched.high_52w, 0) : "N/A"}
- Low 52 minggu  : ${hasEnriched ? fmt(enriched.low_52w, 0) : "N/A"}
- Perubahan 1 bln: ${hasEnriched ? fmt(enriched.change_1m) : "N/A"}%
- Perubahan 3 bln: ${hasEnriched ? fmt(enriched.change_3m) : "N/A"}%

Semua data di atas adalah nilai AKTUAL dari TradingView. Gunakan data ini untuk analisis komprehensif.
Jawab HANYA dalam format JSON yang diminta.`;

      // ─── Kirim ke Claude ────────────────────────────────────────────────────
      const response = await fetch("/api/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-5",
          max_tokens: 1000,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      const data = await response.json();

      if (!data.content) {
        console.error("API error:", JSON.stringify(data.error));
        setError("API error: " + (data.error?.message || "Unknown error"));
        return;
      }

      const fullText = data.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("");

      const jsonMatch = fullText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("Format respons tidak valid");

      const parsed = JSON.parse(jsonMatch[0]);
      setResult(parsed);
      setHistory((prev) => [
        {
          ticker: stockCode,
          time: new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }),
          signal: parsed.signal,
          momentum: parsed.momentum,
        },
        ...prev.slice(0, 4),
      ]);
    } catch (e) {
      setError("Gagal menganalisis saham. Pastikan kode saham benar (contoh: BBCA, TLKM) dan API key sudah diset.");
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const momentumColor = (m) => m === "BULLISH" ? "#00ff88" : m === "BEARISH" ? "#ff4466" : "#ffcc00";
  const signalColor   = (s) => s === "BUY"     ? "#00ff88" : s === "SELL"    ? "#ff4466" : "#ffcc00";
  const signalBg      = (s) => s === "BUY"     ? "rgba(0,255,136,0.1)" : s === "SELL" ? "rgba(255,68,102,0.1)" : "rgba(255,204,0,0.1)";

  return (
    <div style={{
      minHeight: "100vh",
      background: "#050a0f",
      color: "#c8d8e8",
      fontFamily: "'Courier New', monospace",
      padding: "0",
      position: "relative",
      overflow: "hidden"
    }}>
      {/* Grid background */}
      <div style={{
        position: "fixed", inset: 0, opacity: 0.03,
        backgroundImage: "linear-gradient(#00aaff 1px, transparent 1px), linear-gradient(90deg, #00aaff 1px, transparent 1px)",
        backgroundSize: "40px 40px", pointerEvents: "none"
      }} />

      {/* Glow top */}
      <div style={{
        position: "fixed", top: 0, left: "50%", transform: "translateX(-50%)",
        width: "600px", height: "200px",
        background: "radial-gradient(ellipse, rgba(0,170,255,0.08) 0%, transparent 70%)",
        pointerEvents: "none"
      }} />

      <div style={{ maxWidth: "900px", margin: "0 auto", padding: "24px 16px" }}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: "32px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "10px", marginBottom: "6px" }}>
            <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#00ff88", boxShadow: "0 0 8px #00ff88", animation: "pulse 2s infinite" }} />
            <span style={{ fontSize: "11px", letterSpacing: "4px", color: "#00aaff", textTransform: "uppercase" }}>IDX INTRADAY SCANNER</span>
            <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#00ff88", boxShadow: "0 0 8px #00ff88", animation: "pulse 2s infinite" }} />
          </div>
          <h1 style={{ fontSize: "28px", fontWeight: "900", margin: 0, letterSpacing: "2px", fontFamily: "Georgia, serif" }}>
            <span style={{ color: "#00aaff" }}>STOCK</span>
            <span style={{ color: "#ffffff" }}>BOT</span>
            <span style={{ color: "#00aaff", fontSize: "14px", marginLeft: "8px", verticalAlign: "middle" }}>BEI</span>
          </h1>
          <p style={{ fontSize: "11px", color: "#4a6a7a", marginTop: "4px", letterSpacing: "1px" }}>MOMENTUM · SUPPORT · RESISTANCE · SINYAL INTRADAY</p>
        </div>

        {/* Search */}
        <div style={{
          background: "rgba(0,170,255,0.05)",
          border: "1px solid rgba(0,170,255,0.2)",
          borderRadius: "8px",
          padding: "20px",
          marginBottom: "20px"
        }}>
          <div style={{ display: "flex", gap: "10px" }}>
            <div style={{ flex: 1, position: "relative" }}>
              <span style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "#00aaff", fontSize: "14px" }}>$</span>
              <input
                ref={inputRef}
                value={ticker}
                onChange={e => setTicker(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === "Enter" && analyze()}
                placeholder="Kode saham... (BBCA, TLKM, BBRI)"
                style={{
                  width: "100%", padding: "12px 12px 12px 28px",
                  background: "rgba(0,0,0,0.4)", border: "1px solid rgba(0,170,255,0.3)",
                  borderRadius: "6px", color: "#ffffff", fontSize: "16px",
                  fontFamily: "inherit", letterSpacing: "2px", outline: "none",
                  boxSizing: "border-box"
                }}
              />
            </div>
            <button
              onClick={() => analyze()}
              disabled={loading}
              style={{
                padding: "12px 24px", background: loading ? "rgba(0,170,255,0.1)" : "rgba(0,170,255,0.2)",
                border: "1px solid rgba(0,170,255,0.5)", borderRadius: "6px",
                color: "#00aaff", cursor: loading ? "not-allowed" : "pointer",
                fontFamily: "inherit", fontSize: "13px", letterSpacing: "1px",
                transition: "all 0.2s", whiteSpace: "nowrap"
              }}
            >
              {loading ? "SCANNING..." : "ANALISIS →"}
            </button>
          </div>

          {/* Popular stocks */}
          <div style={{ marginTop: "12px", display: "flex", flexWrap: "wrap", gap: "6px" }}>
            <span style={{ fontSize: "10px", color: "#4a6a7a", marginRight: "4px", lineHeight: "24px" }}>POPULER:</span>
            {POPULAR_STOCKS.map(s => (
              <button key={s} onClick={() => { setTicker(s); analyze(s); }}
                style={{
                  padding: "3px 10px", background: "rgba(0,170,255,0.07)",
                  border: "1px solid rgba(0,170,255,0.15)", borderRadius: "4px",
                  color: "#5a8aaa", cursor: "pointer", fontSize: "11px",
                  fontFamily: "inherit", letterSpacing: "1px", transition: "all 0.15s"
                }}>
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div style={{ textAlign: "center", padding: "48px", border: "1px solid rgba(0,170,255,0.1)", borderRadius: "8px" }}>
            <div style={{ fontSize: "11px", color: "#00aaff", letterSpacing: "3px", animation: "blink 1s infinite" }}>
              ◈ MENGAMBIL DATA PASAR...
            </div>
            <div style={{ marginTop: "12px", fontSize: "10px", color: "#2a4a5a" }}>Fetching live price · Loading RSI/MACD/MA · Calculating S/R levels</div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ padding: "16px", background: "rgba(255,68,102,0.1)", border: "1px solid rgba(255,68,102,0.3)", borderRadius: "8px", color: "#ff4466", fontSize: "13px" }}>
            ⚠ {error}
          </div>
        )}

        {/* Result */}
        {result && !loading && (
          <div style={{ display: "grid", gap: "12px" }}>
            {/* Header card */}
            <div style={{
              background: "rgba(0,0,0,0.5)", border: "1px solid rgba(0,170,255,0.25)",
              borderRadius: "8px", padding: "20px",
              display: "grid", gridTemplateColumns: "1fr auto", gap: "16px", alignItems: "center"
            }}>
              <div>
                <div style={{ display: "flex", alignItems: "baseline", gap: "12px" }}>
                  <span style={{ fontSize: "28px", fontWeight: "900", color: "#ffffff", letterSpacing: "2px" }}>{result.ticker?.replace(".JK", "")}</span>
                  <span style={{ fontSize: "12px", color: "#4a6a7a" }}>.JK · IDX</span>
                </div>
                <div style={{ fontSize: "13px", color: "#7a9aaa", marginTop: "2px" }}>{result.companyName}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: "32px", fontWeight: "900", color: "#ffffff" }}>
                  Rp {result.lastPrice?.toLocaleString("id-ID")}
                </div>
                <div style={{ fontSize: "14px", color: result.priceChange?.startsWith("+") ? "#00ff88" : "#ff4466" }}>
                  {result.priceChange} ({result.priceChangePct})
                </div>
                <div style={{ fontSize: "10px", color: "#2a4a5a", marginTop: "4px" }}>Update: {result.lastUpdated}</div>
              </div>
            </div>

            {/* Momentum + Signal row */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              {/* Momentum */}
              <div style={{
                background: "rgba(0,0,0,0.4)", border: `1px solid ${momentumColor(result.momentum)}40`,
                borderRadius: "8px", padding: "16px"
              }}>
                <div style={{ fontSize: "10px", color: "#4a6a7a", letterSpacing: "2px", marginBottom: "8px" }}>MOMENTUM</div>
                <div style={{ fontSize: "24px", fontWeight: "900", color: momentumColor(result.momentum) }}>
                  {result.momentum === "BULLISH" ? "▲" : result.momentum === "BEARISH" ? "▼" : "◆"} {result.momentum}
                </div>
                <div style={{ fontSize: "12px", color: "#5a7a8a", marginTop: "4px" }}>
                  Kekuatan: <span style={{ color: momentumColor(result.momentum) }}>{result.momentumStrength}</span>
                </div>
                <div style={{ marginTop: "12px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
                  {[
                    { label: "RSI", value: result.rsi },
                    { label: "MACD", value: result.macd?.replace("_CROSS", "✓").replace("NEUTRAL", "—") },
                    { label: "VOL", value: result.volume }
                  ].map(item => (
                    <div key={item.label} style={{ background: "rgba(0,170,255,0.05)", borderRadius: "4px", padding: "8px", textAlign: "center" }}>
                      <div style={{ fontSize: "9px", color: "#4a6a7a", letterSpacing: "1px" }}>{item.label}</div>
                      <div style={{ fontSize: "11px", color: "#c8d8e8", marginTop: "2px", fontWeight: "bold" }}>{item.value}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Signal */}
              <div style={{
                background: signalBg(result.signal),
                border: `1px solid ${signalColor(result.signal)}40`,
                borderRadius: "8px", padding: "16px"
              }}>
                <div style={{ fontSize: "10px", color: "#4a6a7a", letterSpacing: "2px", marginBottom: "8px" }}>SINYAL INTRADAY</div>
                <div style={{ fontSize: "32px", fontWeight: "900", color: signalColor(result.signal), letterSpacing: "4px" }}>
                  {result.signal === "BUY" ? "⬆" : result.signal === "SELL" ? "⬇" : "⏸"} {result.signal}
                </div>
                <div style={{ marginTop: "12px", display: "grid", gap: "6px" }}>
                  {[
                    { label: "ENTRY",      value: `Rp ${result.entry?.toLocaleString("id-ID")}`, color: "#c8d8e8" },
                    { label: "TARGET (TP)", value: `Rp ${result.tp?.toLocaleString("id-ID")}`,   color: "#00ff88" },
                    { label: "STOP LOSS",  value: `Rp ${result.sl?.toLocaleString("id-ID")}`,    color: "#ff4466" },
                    { label: "R/R RATIO",  value: result.rrRatio,                                 color: "#ffcc00" },
                  ].map(item => (
                    <div key={item.label} style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
                      <span style={{ color: "#4a6a7a" }}>{item.label}</span>
                      <span style={{ color: item.color, fontWeight: "bold" }}>{item.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Support & Resistance */}
            <div style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(0,170,255,0.2)", borderRadius: "8px", padding: "16px" }}>
              <div style={{ fontSize: "10px", color: "#4a6a7a", letterSpacing: "2px", marginBottom: "14px" }}>SUPPORT & RESISTANCE</div>
              {[
                { label: "R2",    value: result.r2,    color: "#ff4466", bg: "rgba(255,68,102,0.15)" },
                { label: "R1",    value: result.r1,    color: "#ff8866", bg: "rgba(255,136,102,0.1)" },
                { label: "PIVOT", value: result.pivot, color: "#ffcc00", bg: "rgba(255,204,0,0.1)" },
                { label: "S1",    value: result.s1,    color: "#88cc44", bg: "rgba(136,204,68,0.1)" },
                { label: "S2",    value: result.s2,    color: "#00ff88", bg: "rgba(0,255,136,0.15)" },
              ].map(item => (
                <div key={item.label} style={{
                  display: "flex", alignItems: "center", gap: "12px",
                  padding: "8px 12px", marginBottom: "4px",
                  background: item.bg, borderRadius: "6px",
                  borderLeft: `3px solid ${item.color}`
                }}>
                  <span style={{ fontSize: "11px", fontWeight: "bold", color: item.color, width: "40px", letterSpacing: "1px" }}>{item.label}</span>
                  <span style={{ fontSize: "15px", fontWeight: "900", color: "#ffffff" }}>Rp {item.value?.toLocaleString("id-ID")}</span>
                  {result.lastPrice && item.value && (
                    <span style={{ fontSize: "10px", color: "#4a6a7a", marginLeft: "auto" }}>
                      {item.value > result.lastPrice
                        ? `+${(((item.value - result.lastPrice) / result.lastPrice) * 100).toFixed(1)}%`
                        : `${(((item.value - result.lastPrice) / result.lastPrice) * 100).toFixed(1)}%`}
                    </span>
                  )}
                </div>
              ))}
            </div>

            {/* Summary */}
            <div style={{
              background: "rgba(0,170,255,0.04)", border: "1px solid rgba(0,170,255,0.15)",
              borderRadius: "8px", padding: "16px"
            }}>
              <div style={{ fontSize: "10px", color: "#4a6a7a", letterSpacing: "2px", marginBottom: "8px" }}>◈ ANALISIS AI</div>
              <p style={{ margin: 0, fontSize: "13px", lineHeight: "1.7", color: "#a8c0d0" }}>{result.summary}</p>
            </div>

            {/* Disclaimer */}
            <div style={{ fontSize: "10px", color: "#2a3a4a", textAlign: "center", padding: "8px" }}>
              ⚠ Disclaimer: Analisis ini bersifat informatif, bukan rekomendasi investasi. Selalu lakukan riset mandiri dan pertimbangkan risiko sebelum trading.
            </div>
          </div>
        )}

        {/* History */}
        {history.length > 0 && (
          <div style={{ marginTop: "20px", borderTop: "1px solid rgba(0,170,255,0.1)", paddingTop: "16px" }}>
            <div style={{ fontSize: "10px", color: "#2a4a5a", letterSpacing: "2px", marginBottom: "10px" }}>RIWAYAT SCAN</div>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              {history.map((h, i) => (
                <button key={i} onClick={() => { setTicker(h.ticker); analyze(h.ticker); }}
                  style={{
                    padding: "5px 12px", background: "rgba(0,0,0,0.4)",
                    border: "1px solid rgba(0,170,255,0.15)", borderRadius: "4px",
                    color: "#4a6a7a", cursor: "pointer", fontSize: "11px", fontFamily: "inherit",
                    display: "flex", gap: "8px", alignItems: "center"
                  }}>
                  <span style={{ color: signalColor(h.signal) }}>●</span>
                  <span style={{ color: "#c8d8e8" }}>{h.ticker}</span>
                  <span style={{ color: "#2a4a5a" }}>{h.time}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.5} }
        * { box-sizing: border-box; }
        body { margin: 0; padding: 0; }
        input::placeholder { color: #2a4a5a; }
        button:hover { filter: brightness(1.3); }
      `}</style>
    </div>
  );
}
