import express from 'express'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import YahooFinance from 'yahoo-finance2'

const app = express()
const __dirname = dirname(fileURLToPath(import.meta.url))
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] })

app.use(express.static(join(__dirname, 'dist')))

app.get('/stock/:ticker', async (req, res) => {
  const ticker = req.params.ticker.toUpperCase() + '.JK'
  try {
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
    const [quote, chart] = await Promise.all([
      yahooFinance.quote(ticker),
      yahooFinance.chart(ticker, { period1: fiveDaysAgo, interval: '1d' })
    ])
    res.json({ quote, chart: chart.quotes })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.get('*splat', (req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'))
})


app.listen(process.env.PORT || 3000)
