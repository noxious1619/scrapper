import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import { motion } from 'framer-motion'
import confetti from 'canvas-confetti'
import html2canvas from 'html2canvas'
import jsPDF from 'jspdf'
import {
  AlertCircle,
  Box,
  CheckCircle2,
  Download,
  Image as ImageIcon,
  Link as LinkIcon,
  LoaderCircle,
  MessageSquare,
  Minus,
  Search,
  Share2,
  Smile,
  Meh,
  Frown,
  Star,
  ThumbsDown,
  ThumbsUp,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'

type Sentiment = 'positive' | 'neutral' | 'negative'
type PieDatum = { name: string; value: number; color: string }
type CloudWord = {
  term: string
  score: number
  sentiment: Sentiment
  x: number
  y: number
  rotate: 0 | -90
  size: number
  weight: number
  width: number
  height: number
}

type Review = {
  id?: string
  author?: string
  date?: string
  rating?: number
  sentiment?: Sentiment
  review?: string
  title?: string
  verified_purchase?: boolean
  helpful_votes?: number
  images?: string[]
  aspects?: string
  sentiment_score?: number
}

type Summary = {
  total_reviews: number
  average_rating: number | null
  sentiment_counts: Record<string, number>
  top_positive_terms?: Array<[string, number]>
  top_negative_terms?: Array<[string, number]>
}

type ProductInfo = {
  product_id: string
  title: string
  brand: string
  price: string
  image: string
  rating: number | null
  reviews_count: number
  rating_distribution: Record<string, number>
}

type KeyInsights = {
  summary_text: string
  pros: string[]
  cons: string[]
  key_phrases: Array<{ phrase: string; count: number; sentiment: string }>
  most_helpful_positive?: Review | null
  most_helpful_negative?: Review | null
}

type AdvancedAnalytics = {
  verified_vs_nonverified: {
    verified_count: number
    non_verified_count: number
    verified_avg_sentiment_score: number
    non_verified_avg_sentiment_score: number
  }
  sentiment_by_review_length: {
    short_reviews_avg_sentiment_score: number
    long_reviews_avg_sentiment_score: number
  }
  review_velocity_per_month_estimate: number
  seller_response_rate: number | null
}

type AnalyzeResponse = {
  product_id: string
  product: ProductInfo
  summary: Summary
  reviews: Review[]
  key_insights: KeyInsights
  advanced_analytics: AdvancedAnalytics
}

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) || 'http://127.0.0.1:8000'
const SentimentPie = lazy(() => import('./components/SentimentPie'))

const sentimentTone: Record<
  Sentiment,
  {
    emoji: string
    label: string
    chartColor: string
    progressClass: string
    icon: ComponentType<{ className?: string }>
    cardClass: string
    badgeClass: string
  }
> = {
  positive: {
    emoji: '😊',
    label: 'Positive',
    chartColor: '#00FFFF',
    progressClass: 'bg-cyan-400',
    icon: Smile,
    cardClass: 'border-cyan-400/60 bg-cyan-500/6 hover:bg-cyan-400/5',
    badgeClass: 'border-cyan-400/70 bg-cyan-500/16 text-cyan-200',
  },
  neutral: {
    emoji: '😐',
    label: 'Neutral',
    chartColor: '#FFD700',
    progressClass: 'bg-yellow-300',
    icon: Meh,
    cardClass: 'border-yellow-300/60 bg-yellow-400/6 hover:bg-yellow-300/5',
    badgeClass: 'border-yellow-300/70 bg-yellow-400/16 text-yellow-200',
  },
  negative: {
    emoji: '😞',
    label: 'Negative',
    chartColor: '#FF1493',
    progressClass: 'bg-pink-500',
    icon: Frown,
    cardClass: 'border-pink-500/60 bg-pink-500/6 hover:bg-pink-500/5',
    badgeClass: 'border-pink-500/70 bg-pink-500/16 text-pink-200',
  },
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'was', 'are', 'very', 'have', 'from', 'but', 'not',
  'you', 'your', 'its', 'too', 'just', 'they', 'them', 'been', 'about', 'will', 'would', 'can',
  'could', 'into', 'also', 'than', 'what', 'when', 'where', 'why', 'how', 'much', 'more', 'less',
  'only', 'after', 'before', 'because', 'really', 'there', 'their', 'amazon', 'product',
])

const CLOUD_WIDTH = 1000
const CLOUD_HEIGHT = 360
const CLOUD_PADDING = 12
const MAX_CLOUD_WORDS = 28
const CLOUD_ANCHORS = [
  { x: 0.06, y: 0.18 },
  { x: 0.20, y: 0.12 },
  { x: 0.36, y: 0.16 },
  { x: 0.52, y: 0.12 },
  { x: 0.68, y: 0.16 },
  { x: 0.82, y: 0.12 },
  { x: 0.94, y: 0.18 },
  { x: 0.08, y: 0.48 },
  { x: 0.24, y: 0.46 },
  { x: 0.42, y: 0.50 },
  { x: 0.60, y: 0.46 },
  { x: 0.78, y: 0.50 },
  { x: 0.92, y: 0.46 },
  { x: 0.10, y: 0.80 },
  { x: 0.30, y: 0.82 },
  { x: 0.50, y: 0.78 },
  { x: 0.70, y: 0.82 },
  { x: 0.90, y: 0.80 },
] as const

function App() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<AnalyzeResponse | null>(null)
  const [selectedWord, setSelectedWord] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [sentimentFilter, setSentimentFilter] = useState<'all' | Sentiment>('all')
  const [ratingFilter, setRatingFilter] = useState<number | null>(null)
  const [sortBy, setSortBy] = useState<'recent' | 'helpful' | 'highest'>('recent')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [hoveredWord, setHoveredWord] = useState<CloudWord | null>(null)
  const analysisRef = useRef<HTMLDivElement>(null)

  const stats = useMemo(() => {
    if (!result) return null
    const total = result.summary.total_reviews || 0
    const counts = {
      positive: result.summary.sentiment_counts.positive || 0,
      neutral: result.summary.sentiment_counts.neutral || 0,
      negative: result.summary.sentiment_counts.negative || 0,
    }
    const averageRating =
      result.summary.average_rating === null || result.summary.average_rating === undefined
        ? '0.0'
        : Number(result.summary.average_rating).toFixed(1)
    const positivePct = total ? Math.round((counts.positive / total) * 100) : 0
    const neutralPct = total ? Math.round((counts.neutral / total) * 100) : 0
    const negativePct = total ? Math.round((counts.negative / total) * 100) : 0
    const dominant: Sentiment =
      counts.positive >= counts.neutral && counts.positive >= counts.negative
        ? 'positive'
        : counts.neutral >= counts.negative
          ? 'neutral'
          : 'negative'
    return { total, counts, averageRating, positivePct, neutralPct, negativePct, dominant }
  }, [result])

  const sentimentData: PieDatum[] = stats
    ? [
        { name: 'Positive', value: stats.counts.positive, color: sentimentTone.positive.chartColor },
        { name: 'Neutral', value: stats.counts.neutral, color: sentimentTone.neutral.chartColor },
        { name: 'Negative', value: stats.counts.negative, color: sentimentTone.negative.chartColor },
      ]
    : []

  useEffect(() => {
    if (stats && stats.positivePct > 80) {
      confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } })
    }
  }, [stats])

  const ratingBreakdown = useMemo(() => {
    if (!result) return []
    const dist = result.product.rating_distribution || {}
    const total = Math.max(1, result.product.reviews_count || result.summary.total_reviews || result.reviews.length || 1)
    const reviewCounts = [5, 4, 3, 2, 1].map((star) =>
      result.reviews.filter((r) => Math.round(Number(r.rating || 0)) === star).length,
    )
    const hasDistribution = Object.values(dist).some((v) => Number(v) > 0)
    return [5, 4, 3, 2, 1].map((star) => {
      const idx = 5 - star
      const raw = Number(dist[String(star)] || 0)
      const count = hasDistribution
        ? raw > 1
          ? raw
          : Math.round((raw / 100) * total)
        : reviewCounts[idx]
      return { star, count, pct: Number(((count / total) * 100).toFixed(1)) }
    })
  }, [result])

  const wordCloud = useMemo<CloudWord[]>(() => {
    if (!result?.reviews?.length) return []

    const freq = new Map<string, { term: string; score: number; sentiment: Sentiment }>()
    for (const review of result.reviews) {
      const sentiment = (review.sentiment || 'neutral') as Sentiment
      const text = `${review.title || ''} ${review.review || ''}`.toLowerCase()
      const words = text.match(/[a-z]{4,}/g) || []
      for (const w of words) {
        if (STOPWORDS.has(w)) continue
        const entry = freq.get(w) || { term: w, score: 0, sentiment }
        entry.score += 1
        entry.sentiment = sentiment
        freq.set(w, entry)
      }
    }

    const top = Array.from(freq.values()).sort((a, b) => b.score - a.score).slice(0, MAX_CLOUD_WORDS)
    if (!top.length) return []

    const maxScore = top[0].score
    const minScore = top[top.length - 1].score
    const span = Math.max(1, maxScore - minScore)

    const placed: CloudWord[] = []

    const intersects = (x: number, y: number, width: number, height: number) => {
      const left = x - width / 2
      const topY = y - height / 2
      for (const p of placed) {
        const pLeft = p.x - p.width / 2
        const pTop = p.y - p.height / 2
        if (left < pLeft + p.width && left + width > pLeft && topY < pTop + p.height && topY + height > pTop) {
          return true
        }
      }
      return false
    }

    for (let i = 0; i < top.length; i++) {
      const w = top[i]
      const normalized = (w.score - minScore) / span
      let size = 15 + Math.round(normalized * 42)
      let weight = 560 + Math.round(normalized * 300)
      let placedWord: CloudWord | null = null

      while (size >= 13 && !placedWord) {
        const textWidth = Math.max(size * 2.4, Math.round(size * 0.6 * w.term.length))
        const preferVertical = i % 3 === 1 || normalized > 0.8
        const candidates: Array<{ rotate: 0 | -90; width: number; height: number }> = preferVertical
          ? [
              { rotate: -90, width: size * 1.2, height: textWidth },
              { rotate: 0, width: textWidth, height: size * 1.2 },
            ]
          : [
              { rotate: 0, width: textWidth, height: size * 1.2 },
              { rotate: -90, width: size * 1.2, height: textWidth },
            ]

        for (const c of candidates) {
          const anchor = CLOUD_ANCHORS[i % CLOUD_ANCHORS.length]
          const anchorX = Math.round(CLOUD_WIDTH * anchor.x)
          const anchorY = Math.round(CLOUD_HEIGHT * anchor.y)
          const maxRadius = Math.max(CLOUD_WIDTH, CLOUD_HEIGHT) * 0.46
          for (let r = 0; r <= maxRadius; r += 9) {
            for (let a = 0; a < Math.PI * 2; a += 0.3) {
              const jitter = ((i * 17 + Math.floor(r) * 11) % 9) - 4
              const x = anchorX + Math.cos(a) * r + jitter
              const y = anchorY + Math.sin(a) * r - jitter * 0.6
              const halfW = c.width / 2
              const halfH = c.height / 2
              if (
                x - halfW < CLOUD_PADDING ||
                x + halfW > CLOUD_WIDTH - CLOUD_PADDING ||
                y - halfH < CLOUD_PADDING ||
                y + halfH > CLOUD_HEIGHT - CLOUD_PADDING
              ) {
                continue
              }
              if (!intersects(x, y, c.width, c.height)) {
                placedWord = {
                  term: w.term,
                  score: w.score,
                  sentiment: w.sentiment,
                  x,
                  y,
                  rotate: c.rotate,
                  size,
                  weight,
                  width: c.width,
                  height: c.height,
                }
                break
              }
            }
            if (placedWord) break
          }
          if (placedWord) break
        }

        if (!placedWord) {
          size -= 1
          weight = Math.max(520, weight - 16)
        }
      }

      if (placedWord) placed.push(placedWord)
    }

    return placed
  }, [result])

  const filteredReviews = useMemo(() => {
    if (!result) return []
    let rows = [...result.reviews]
    if (sentimentFilter !== 'all') rows = rows.filter((r) => (r.sentiment || 'neutral') === sentimentFilter)
    if (ratingFilter !== null) rows = rows.filter((r) => Math.round(Number(r.rating || 0)) === ratingFilter)
    if (selectedWord) {
      const keyword = selectedWord.toLowerCase()
      rows = rows.filter((r) => `${r.title || ''} ${r.review || ''}`.toLowerCase().includes(keyword))
    }
    if (searchTerm.trim()) {
      const keyword = searchTerm.toLowerCase()
      rows = rows.filter((r) => `${r.author || ''} ${r.title || ''} ${r.review || ''}`.toLowerCase().includes(keyword))
    }
    rows.sort((a, b) => {
      if (sortBy === 'helpful') return Number(b.helpful_votes || 0) - Number(a.helpful_votes || 0)
      if (sortBy === 'highest') return Number(b.rating || 0) - Number(a.rating || 0)
      return toEpoch(b.date) - toEpoch(a.date)
    })
    return rows
  }, [result, sentimentFilter, ratingFilter, selectedWord, searchTerm, sortBy])

  const runAnalysis = async () => {
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const response = await fetch(`${API_BASE}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data.detail || 'Analysis failed.')
        return
      }
      setResult(data as AnalyzeResponse)
    } catch {
      setError('Cannot connect to backend API. Start Python API server on port 8000.')
    } finally {
      setLoading(false)
    }
  }

  const shareResult = async () => {
    if (navigator.share) {
      await navigator.share({ title: 'Amazon Review Analysis', url: window.location.href })
    } else {
      await navigator.clipboard.writeText(window.location.href)
    }
  }

  const captureAnalysisCanvas = async (scale: number) => {
    if (!analysisRef.current) return null
    return html2canvas(analysisRef.current, {
      backgroundColor: '#05030a',
      useCORS: true,
      allowTaint: false,
      scale,
      onclone: (doc) => {
        doc.querySelectorAll('img').forEach((img) => {
          const src = img.getAttribute('src') || ''
          if (src.startsWith('http')) img.setAttribute('data-html2canvas-ignore', 'true')
        })
      },
    })
  }

  const captureScreenshot = async () => {
    if (!analysisRef.current) return
    try {
      setError('')
      const canvas = await captureAnalysisCanvas(1.5)
      if (!canvas) return
      const link = document.createElement('a')
      link.download = 'review-analysis.png'
      link.href = canvas.toDataURL('image/png')
      link.click()
    } catch {
      setError('Could not capture screenshot for this view.')
    }
  }

  const exportPdf = async () => {
    if (!analysisRef.current) return
    try {
      setError('')
      let canvas = await captureAnalysisCanvas(1.25)
      if (!canvas) return
      // Retry with lower scale for very long pages / lower-memory devices.
      if (canvas.width * canvas.height > 28_000_000) {
        const retry = await captureAnalysisCanvas(1)
        if (retry) canvas = retry
      }

      const img = canvas.toDataURL('image/png')
      const pdf = new jsPDF('p', 'mm', 'a4')
      const pageWidth = 210
      const pageHeight = 297
      const margin = 7
      const usableWidth = pageWidth - margin * 2
      const scaledImgHeight = (canvas.height / canvas.width) * usableWidth

      let yOffset = 0
      let page = 0
      while (yOffset < scaledImgHeight) {
        if (page > 0) pdf.addPage()
        pdf.addImage(img, 'PNG', margin, margin - yOffset, usableWidth, scaledImgHeight)
        yOffset += pageHeight - margin * 2
        page += 1
      }
      pdf.save('review-analysis.pdf')
    } catch {
      setError('Could not generate PDF for this view.')
    }
  }

  const hasAnalysis = Boolean(result && stats)
  const dominantTone = stats ? sentimentTone[stats.dominant] : sentimentTone.neutral

  return (
    <div className="retro-grid min-h-screen px-3 py-10 md:px-5">
      <div className="mx-auto w-full max-w-[1800px]">
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="mb-6 flex flex-col items-center">
          <div className="mb-2 rounded-lg border border-cyan-400/90 bg-black/60 p-2 text-cyan-300 shadow-[0_0_20px_rgba(0,255,255,0.35)]">
            <Box className="h-7 w-7" />
          </div>
          <h1 className="bg-gradient-to-r from-cyan-300 via-fuchsia-400 to-pink-500 bg-clip-text text-5xl font-bold text-transparent md:text-6xl">
            REVIEW ANALYZER
          </h1>
          <p className="mt-2 text-base tracking-wide text-cyan-300">&gt; AI-POWERED SENTIMENT ANALYSIS_</p>
        </motion.div>

        {hasAnalysis ? (
          <div className="mb-4 flex flex-wrap justify-end gap-2">
            <button className="action-btn" onClick={shareResult}><Share2 className="h-4 w-4" /> Share</button>
            <button className="action-btn" onClick={captureScreenshot}><ImageIcon className="h-4 w-4" /> Screenshot</button>
            <button className="action-btn" onClick={exportPdf}><Download className="h-4 w-4" /> PDF</button>
          </div>
        ) : null}

        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="retro-card mx-auto mb-8 w-full max-w-5xl p-5">
          <label className="mb-2 block text-sm tracking-wide text-cyan-300">&gt; ENTER AMAZON PRODUCT URL</label>
          <div className="flex flex-col gap-3 md:flex-row">
            <div className="relative flex-1">
              <LinkIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cyan-300/70" />
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://amzn.in/..."
                className="w-full rounded-lg border border-pink-500/50 bg-black/55 py-2.5 pl-10 pr-4 text-cyan-100 outline-none transition focus:border-cyan-300 focus:shadow-[0_0_14px_rgba(0,255,255,0.25)]"
              />
            </div>
            <button
              onClick={runAnalysis}
              disabled={loading || !url.trim()}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-pink-500/80 bg-gradient-to-r from-pink-600/90 to-fuchsia-500/90 px-5 py-2.5 text-sm font-semibold text-white transition hover:shadow-[0_0_18px_rgba(255,20,147,0.45)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              ANALYZE
            </button>
          </div>
          {error ? (
            <div className="mt-3 inline-flex items-center gap-2 rounded-md border border-pink-500/70 bg-pink-500/12 px-3 py-1.5 text-xs text-pink-200">
              <AlertCircle className="h-3.5 w-3.5" />
              {error}
            </div>
          ) : null}
        </motion.div>

        {loading ? (
          <div className="retro-card flex items-center justify-center gap-2 p-8 text-cyan-200">
            <LoaderCircle className="h-5 w-5 animate-spin" />
            SCRAPING AND ANALYZING...
          </div>
        ) : null}

        {!loading && !hasAnalysis ? (
          <div className="retro-card p-8 text-center text-purple-100">Detailed analysis appears after successful scan.</div>
        ) : null}

        {hasAnalysis && stats && result ? (
          <motion.div ref={analysisRef} variants={{ show: { transition: { staggerChildren: 0.07 } } }} initial="hidden" animate="show" className="space-y-5">
            <motion.div variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }} className="retro-card p-4">
              <div className="grid gap-4 md:grid-cols-[120px_1fr]">
                <div className="h-28 w-28 overflow-hidden rounded-lg border border-cyan-400/40 bg-black/40">
                  {result.product?.image ? <img src={result.product.image} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-cyan-300">No image</div>}
                </div>
                <div>
                  <h2 className="text-xl text-cyan-100">{result.product?.title || `Product ${result.product_id}`}</h2>
                  <div className="mt-1 flex flex-wrap gap-3 text-sm text-purple-100">
                    <span>Brand: {safeText(result.product?.brand, 'Unknown')}</span>
                    <span>Price: {safeText(result.product?.price, '-')}</span>
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/60 bg-emerald-500/10 px-2 py-0.5 text-emerald-300">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Verified Purchase
                    </span>
                  </div>
                </div>
              </div>
            </motion.div>

            <motion.div variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }} className="grid gap-4 lg:grid-cols-2">
              <div className="retro-card p-4">
                <h3 className="mb-2 text-sm text-cyan-300">&gt; KEY INSIGHTS</h3>
                <p className="text-sm text-purple-100">{result.key_insights?.summary_text}</p>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  <div>
                    <p className="mb-1 text-xs text-emerald-300">Customers loved</p>
                    <ul className="space-y-1 text-xs text-purple-100">{(result.key_insights?.pros || []).map((p) => <li key={p}>- {p}</li>)}</ul>
                  </div>
                  <div>
                    <p className="mb-1 text-xs text-pink-300">Customers disliked</p>
                    <ul className="space-y-1 text-xs text-purple-100">{(result.key_insights?.cons || []).map((c) => <li key={c}>- {c}</li>)}</ul>
                  </div>
                </div>
              </div>
              <div className="retro-card p-4">
                <h3 className="mb-2 text-sm text-yellow-300">&gt; MOST HELPFUL REVIEWS</h3>
                <HelpfulCard label="Positive" review={result.key_insights?.most_helpful_positive} />
                <HelpfulCard label="Negative" review={result.key_insights?.most_helpful_negative} />
              </div>
            </motion.div>
            <motion.div variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }} className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <StatCard title="TOTAL REVIEWS" value={String(stats.total)} icon={MessageSquare} tone="positive" />
              <StatCard title="AVERAGE RATING" value={stats.averageRating} icon={Star} tone="neutral" />
              <StatCard title="POSITIVE" value={`${stats.positivePct}%`} icon={TrendingUp} tone="positive" />
              <StatCard title="NEGATIVE" value={`${stats.negativePct}%`} icon={TrendingDown} tone="negative" />
            </motion.div>

            <motion.div variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }} className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
              <div className="retro-card grid-hover p-4">
                <h3 className="mb-3 text-sm text-cyan-300">&gt; SENTIMENT DISTRIBUTION</h3>
                <div className="h-80">
                  <Suspense fallback={<div className="flex h-full items-center justify-center text-purple-100">Loading chart...</div>}>
                    <SentimentPie data={sentimentData} />
                  </Suspense>
                </div>
              </div>
              <div className="grid gap-4">
                <div className="retro-card grid-hover p-4">
                  <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-center">
                    <div>
                      <h3 className="mb-3 text-sm text-pink-300">&gt; SENTIMENT BREAKDOWN</h3>
                      <div className="space-y-5">
                        <ProgressBar sentiment="positive" value={stats.positivePct} />
                        <ProgressBar sentiment="neutral" value={stats.neutralPct} />
                        <ProgressBar sentiment="negative" value={stats.negativePct} />
                      </div>
                    </div>
                    <div className="justify-self-center md:justify-self-end">
                      <motion.div
                        animate={{ scale: [1, 1.07, 1], y: [0, -4, 0] }}
                        transition={{ repeat: Number.POSITIVE_INFINITY, duration: 2.3 }}
                        className="mb-2 inline-flex h-40 w-40 items-center justify-center rounded-full bg-gradient-to-br from-orange-300 to-orange-500 text-8xl shadow-[0_0_32px_rgba(255,165,0,0.4)]"
                      >
                        {dominantTone.emoji}
                      </motion.div>
                      <div className="mx-auto w-fit rounded-full border border-yellow-300/80 bg-yellow-400/85 px-4 py-1 text-xs font-semibold text-slate-900">
                        {stats[`${stats.dominant}Pct` as const]}% {dominantTone.label}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>

            <motion.div variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }} className="grid gap-4">
              <div className="retro-card p-4">
                <h3 className="mb-3 text-sm text-yellow-300">&gt; RATING DISTRIBUTION (click to filter)</h3>
                <div className="space-y-2">
                  {ratingBreakdown.map((r) => (
                    <button
                      key={r.star}
                      onClick={() => setRatingFilter((prev) => (prev === r.star ? null : r.star))}
                      className={`w-full rounded border px-2 py-1 text-left text-xs ${
                        ratingFilter === r.star ? 'border-cyan-400/70 bg-cyan-400/10' : 'border-purple-400/40'
                      }`}
                    >
                      <div className="mb-1 flex justify-between"><span>{r.star} star</span><span>{r.pct}%</span></div>
                      <div className="h-2 rounded bg-cyan-950/40"><div className="h-full rounded bg-yellow-300" style={{ width: `${r.pct}%` }} /></div>
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>

            <motion.div variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }} className="retro-card p-4">
              <h3 className="mb-3 text-sm text-fuchsia-300">&gt; INDIVIDUAL REVIEWS</h3>
              <div className="mb-3 grid gap-2 md:grid-cols-4">
                <input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search reviews..." className="rounded border border-purple-400/40 bg-black/40 px-3 py-2 text-sm text-cyan-100" />
                <select value={sentimentFilter} onChange={(e) => setSentimentFilter(e.target.value as any)} className="rounded border border-purple-400/40 bg-black/40 px-3 py-2 text-sm text-cyan-100">
                  <option value="all">All sentiments</option>
                  <option value="positive">Positive</option>
                  <option value="neutral">Neutral</option>
                  <option value="negative">Negative</option>
                </select>
                <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)} className="rounded border border-purple-400/40 bg-black/40 px-3 py-2 text-sm text-cyan-100">
                  <option value="recent">Most recent</option>
                  <option value="helpful">Most helpful</option>
                  <option value="highest">Highest rating</option>
                </select>
                <button className="action-btn" onClick={() => { setSearchTerm(''); setSentimentFilter('all'); setRatingFilter(null); setSelectedWord('') }}>Reset</button>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {filteredReviews.map((review, idx) => {
                  const sentiment = (review.sentiment || 'neutral') as Sentiment
                  const tone = sentimentTone[sentiment]
                  const rating = Math.round(Number(review.rating || 0))
                  const key = `${review.id || review.author || 'anon'}-${idx}`
                  const expandedReview = Boolean(expanded[key])
                  const body = (review.review || '').trim()
                  const shortBody = body.length > 180 && !expandedReview ? `${body.slice(0, 180)}...` : body
                  const tags = String(review.aspects || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 3)
                  return (
                    <motion.div
                      key={key}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.04 * idx }}
                      className={`grid-hover rounded-lg border p-3 transition ${tone.cardClass}`}
                    >
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-xs font-semibold text-cyan-100">{safeText(review.author, 'Anonymous')}</span>
                        <SentimentBadge sentiment={sentiment} />
                      </div>
                      <div className="mb-2 flex items-center gap-1 text-yellow-300">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Star key={`${idx}-${i}`} className={`h-3.5 w-3.5 ${i < rating ? 'fill-current' : ''}`} />
                        ))}
                        {formatReviewDate(review.date) ? (
                          <span className="ml-1 text-[10px] text-purple-100">{formatReviewDate(review.date)}</span>
                        ) : null}
                        {review.verified_purchase ? <span className="rounded-full border border-emerald-400/60 bg-emerald-500/12 px-2 py-0.5 text-[10px] text-emerald-300">Verified</span> : null}
                        <span className="text-[10px] text-cyan-200">{review.helpful_votes || 0} helpful</span>
                      </div>
                      {review.images && review.images.length > 0 ? (
                        <div className="mb-2 grid grid-cols-4 gap-2">
                          {review.images.slice(0, 4).map((img, i) => <img key={`${key}-img-${i}`} src={img} className="h-14 w-full rounded object-cover" />)}
                        </div>
                      ) : null}
                      <div className="mb-2 flex flex-wrap gap-1">{tags.map((tag) => <span key={`${key}-${tag}`} className="rounded-full border border-cyan-400/40 bg-cyan-500/10 px-2 py-0.5 text-[10px] text-cyan-200">{tag}</span>)}</div>
                      <p className="text-xs leading-5 text-purple-100">{shortBody || 'No review text provided.'}</p>
                      {body.length > 180 ? (
                        <button className="mt-1 text-xs text-cyan-300" onClick={() => setExpanded((p) => ({ ...p, [key]: !expandedReview }))}>
                          {expandedReview ? 'Show less' : 'Show more'}
                        </button>
                      ) : null}
                    </motion.div>
                  )
                })}
                {filteredReviews.length === 0 ? (
                  <div className="col-span-full rounded-lg border border-purple-400/30 bg-black/40 p-4 text-sm text-purple-200">
                    No reviews match the current filters.
                  </div>
                ) : null}
              </div>
            </motion.div>

            <motion.div variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }} className="retro-card border-yellow-300/50 p-4">
              <h3 className="mb-1 text-sm text-yellow-300">&gt; SENTIMENT WORD CLOUD</h3>
              <p className="mb-4 text-xs text-purple-100">
                Most frequently mentioned words color-coded by sentiment: <span className="text-cyan-300">CYAN</span> (Positive),{' '}
                <span className="text-yellow-300">YELLOW</span> (Neutral), <span className="text-pink-400">PINK</span> (Negative)
              </p>
              {selectedWord ? (
                <div className="mb-2">
                  <button className="action-btn" onClick={() => setSelectedWord('')}>Clear word filter: {selectedWord}</button>
                </div>
              ) : null}
              <div
                className="relative h-[22rem] overflow-hidden rounded-lg border border-yellow-300/30 bg-black/35 p-2"
                onMouseLeave={() => setHoveredWord(null)}
              >
                {hoveredWord ? (
                  <div className="pointer-events-none absolute right-3 top-3 z-20 rounded-md border border-purple-300/40 bg-black/80 px-3 py-2 text-xs text-purple-100">
                    <div className="font-semibold text-cyan-200">{hoveredWord.term}</div>
                    <div>{hoveredWord.score} mentions</div>
                    <div className="uppercase">{hoveredWord.sentiment}</div>
                  </div>
                ) : null}
                <svg viewBox={`0 0 ${CLOUD_WIDTH} ${CLOUD_HEIGHT}`} className="h-full w-full">
                  {wordCloud.map((w, idx) => {
                    const color = w.sentiment === 'positive' ? '#00FFFF' : w.sentiment === 'neutral' ? '#FFD700' : '#FF4DB8'
                    return (
                      <motion.text
                        key={`${w.term}-${idx}`}
                        x={w.x}
                        y={w.y}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        transform={`rotate(${w.rotate} ${w.x} ${w.y})`}
                        fill={color}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.35, delay: idx * 0.02 }}
                        whileHover={{ scale: 1.08 }}
                        onMouseEnter={() => setHoveredWord(w)}
                        onClick={() => setSelectedWord(w.term)}
                        style={{
                          fontSize: `${w.size}px`,
                          fontWeight: w.weight,
                          filter: 'drop-shadow(0 0 6px rgba(255,255,255,0.25))',
                          cursor: 'pointer',
                        }}
                      >
                        {w.term}
                        <title>{`${w.term} - ${w.score} mentions - ${w.sentiment}`}</title>
                      </motion.text>
                    )
                  })}
                </svg>
              </div>
            </motion.div>

          </motion.div>
        ) : null}
      </div>
    </div>
  )
}

function StatCard({
  title,
  value,
  icon: Icon,
  tone,
}: {
  title: string
  value: string
  icon: ComponentType<{ className?: string }>
  tone: Sentiment
}) {
  const borderClass =
    tone === 'positive'
      ? 'border-cyan-400/60 hover:bg-cyan-500/6 hover:shadow-[0_0_18px_rgba(0,255,255,0.22)]'
      : tone === 'neutral'
        ? 'border-yellow-300/60 hover:bg-yellow-300/6 hover:shadow-[0_0_18px_rgba(255,215,0,0.22)]'
        : 'border-pink-500/60 hover:bg-pink-500/6 hover:shadow-[0_0_18px_rgba(255,20,147,0.22)]'

  const iconClass =
    tone === 'positive'
      ? 'from-cyan-300 to-cyan-500 text-black'
      : tone === 'neutral'
        ? 'from-yellow-300 to-amber-400 text-black'
        : 'from-pink-500 to-fuchsia-500 text-white'

  const valueClass = tone === 'neutral' ? 'text-yellow-300' : tone === 'negative' ? 'text-pink-400' : 'text-cyan-300'

  return (
    <motion.div whileHover={{ y: -3 }} className={`grid-hover rounded-lg border bg-black/45 p-5 transition ${borderClass}`}>
      <div className={`mb-3 inline-flex rounded-md bg-gradient-to-br p-2.5 shadow-lg ${iconClass}`}>
        <Icon className="h-4 w-4" />
      </div>
      <p className="text-sm text-purple-100">{title}</p>
      <p className={`mt-1 text-3xl font-bold ${valueClass}`}>{value}</p>
    </motion.div>
  )
}

function ProgressBar({ sentiment, value }: { sentiment: Sentiment; value: number }) {
  const tone = sentimentTone[sentiment]
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className={sentiment === 'positive' ? 'text-cyan-300' : sentiment === 'neutral' ? 'text-yellow-300' : 'text-pink-400'}>
          {tone.label.toUpperCase()}
        </span>
        <span className="text-cyan-100">{value.toFixed(1)}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded bg-cyan-950/40">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ duration: 0.8 }}
          className={`h-full ${tone.progressClass} shadow-[0_0_12px_rgba(255,255,255,0.35)]`}
        />
      </div>
    </div>
  )
}

function SentimentBadge({ sentiment }: { sentiment: Sentiment }) {
  const tone = sentimentTone[sentiment]
  const Icon = sentiment === 'positive' ? ThumbsUp : sentiment === 'neutral' ? Minus : ThumbsDown
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${tone.badgeClass}`}>
      <Icon className="h-3 w-3" />
      {sentiment.toUpperCase()}
    </span>
  )
}

function HelpfulCard({ label, review }: { label: string; review?: Review | null }) {
  if (!review) return <div className="mb-3 rounded border border-purple-400/30 p-2 text-xs text-purple-100">{label}: not available</div>
  return (
    <div className="mb-3 rounded border border-purple-400/30 p-2">
      <p className="mb-1 text-xs text-cyan-300">{label} helpful review</p>
      <p className="text-xs text-purple-100">{safeText(review.review, 'No review text provided.')}</p>
    </div>
  )
}

function toEpoch(raw?: string) {
  const parsed = parseReviewDate(raw)
  return parsed ? parsed.getTime() : 0
}

function parseReviewDate(raw?: string) {
  if (!raw) return null
  const clean = raw.trim()
  if (!clean || clean.toLowerCase() === 'n/a') return null
  const direct = new Date(clean)
  if (!Number.isNaN(direct.getTime())) return direct
  const m = clean.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/)
  if (m) {
    const d2 = new Date(`${m[2]} ${m[1]}, ${m[3]}`)
    if (!Number.isNaN(d2.getTime())) return d2
  }
  return null
}

function formatReviewDate(date?: string) {
  const parsed = parseReviewDate(date)
  if (parsed) return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return ''
}

function safeText(value?: string, fallback = '-') {
  const clean = (value || '').trim()
  if (!clean || clean.toLowerCase() === 'n/a') return fallback
  return clean
}

export default App
