import express from 'express'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import YahooFinance from 'yahoo-finance2'

const app = express()
const __dirname = dirname(fileURLToPath(import.meta.url))
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] })

app.use(express.json())
app.use(express.static(join(__dirname, 'dist')))

// Proxy ke Anthropic API
app.post('/api/v1/messages', async (req, res) => {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(req.body)
    })
    const data = await response.json()
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Yahoo Finance
app.get('/stock/:ticker', async (req, res) => {
  const ticker = req.params.ticker.toUpperCase() + '.JK'
  try {
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
    const quote = await yahooFinance.quote(ticker)
    let chart = []
    try {
      const chartData = await yahooFinance.chart(ticker, { period1: fiveDaysAgo, interval: '1d' })
      chart = chartData.quotes
    } catch (chartErr) {
      console.error('Chart error:', chartErr.message)
    }
    res.json({ quote, chart })
  } catch (e) {
    console.error('Yahoo Finance error:', e.message)
    res.status(500).json({ error: e.message })
  }
})

app.get('*splat', (req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'))
})

app.listen(process.env.PORT || 3000)


