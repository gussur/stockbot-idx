import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import dns from 'dns'
import YahooFinance from 'yahoo-finance2'
const yahooFinance = new YahooFinance()

dns.setDefaultResultOrder('ipv4first')

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      react(),
      {
        name: 'stock-api',
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            if (!req.url.startsWith('/stock/')) return next()

            const ticker = req.url.replace('/stock/', '').toUpperCase() + '.JK'
            console.log('Fetching ticker:', ticker)

            try {
              const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
              const [quote, chart] = await Promise.all([
              yahooFinance.quote(ticker),
              yahooFinance.chart(ticker, { period1: fiveDaysAgo, interval: '1d' })
              ])
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ quote, chart: chart.quotes }))
            } catch (e) {
              console.error('Yahoo Finance error:', e.message, e.stack)  // ← ubah ini
              res.statusCode = 500
              res.end(JSON.stringify({ error: e.message }))
            }
          })
        }
      }
    ],
    server: {
      proxy: {
        '/api': {
          target: 'https://api.anthropic.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.setHeader('x-api-key', env.ANTHROPIC_API_KEY)
              proxyReq.setHeader('anthropic-version', '2023-06-01')
              proxyReq.setHeader('anthropic-dangerous-direct-browser-access', 'true')
              proxyReq.removeHeader('origin')
            })
          }
        }
      }
    }
  }
})