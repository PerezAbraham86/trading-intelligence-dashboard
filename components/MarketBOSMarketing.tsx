import Link from 'next/link'
import {
  BarChart3,
  Bell,
  BookOpen,
  Brain,
  CheckCircle2,
  ChevronRight,
  Crown,
  Download,
  GraduationCap,
  Grid2X2,
  LineChart,
  Lock,
  Package,
  Radio,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  Zap,
} from 'lucide-react'

type PageKey =
  | 'home'
  | 'membership'
  | 'indicators'
  | 'signals'
  | 'academy'
  | 'dashboard'
  | 'trading-room'
  | 'shop'
  | 'about'

const navItems: { label: string; href: string; key: PageKey }[] = [
  { label: 'Home', href: '/membership', key: 'home' },
  { label: 'Indicators', href: '/indicators', key: 'indicators' },
  { label: 'Signals', href: '/', key: 'signals' },
  { label: 'Academy', href: '/academy', key: 'academy' },
  { label: 'Dashboard', href: '/', key: 'dashboard' },
  { label: 'Trading Room', href: '/trading-room', key: 'trading-room' },
  { label: 'Shop', href: '/shop', key: 'shop' },
  { label: 'About', href: '/about', key: 'about' },
]

const gold = 'text-amber-400'
const card = 'rounded-2xl border border-white/10 bg-slate-950/70 shadow-2xl shadow-black/30 backdrop-blur'
const softCard = 'rounded-2xl border border-amber-400/20 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 shadow-xl shadow-black/20'

export function MarketingShell({
  active,
  children,
}: {
  active: PageKey
  children: React.ReactNode
}) {
  return (
    <main className="min-h-screen bg-[#05090f] text-white">
      <div className="fixed inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.12),transparent_30%),radial-gradient(circle_at_top_right,rgba(14,165,233,0.08),transparent_30%)]" />
      <header className="sticky top-0 z-50 border-b border-white/10 bg-[#05090f]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
          <Link href="/membership" className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-amber-400/40 bg-amber-400/10 text-xl font-black text-amber-400">
              MB
            </div>
            <div className="leading-tight">
              <div className="text-lg font-black tracking-wide">
                MARKET<span className="text-amber-400">BOS</span>
              </div>
              <div className="text-xs font-semibold tracking-[0.35em] text-amber-400">ALGO</div>
            </div>
          </Link>

          <nav className="hidden items-center gap-7 text-sm text-slate-300 lg:flex">
            {navItems.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className={`relative transition hover:text-amber-300 ${
                  active === item.key ? 'text-amber-300' : ''
                }`}
              >
                {item.label}
                {active === item.key && (
                  <span className="absolute -bottom-4 left-0 h-0.5 w-full rounded-full bg-amber-400" />
                )}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="hidden rounded-lg border border-white/10 px-4 py-2 text-sm text-slate-200 hover:border-amber-400/50 md:block"
            >
              Login
            </Link>
            <Link
              href="/membership"
              className="rounded-lg bg-gradient-to-r from-amber-300 to-amber-500 px-4 py-2 text-sm font-bold text-black shadow-lg shadow-amber-500/20 hover:from-amber-200 hover:to-amber-400"
            >
              Join Now
            </Link>
          </div>
        </div>
      </header>

      {children}
    </main>
  )
}

export function Badge({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-5 inline-flex rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs font-bold uppercase tracking-wide text-amber-300">
      {children}
    </div>
  )
}

export function PrimaryButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-300 to-amber-500 px-6 py-3 font-bold text-black shadow-lg shadow-amber-500/20 hover:from-amber-200 hover:to-amber-400"
    >
      {children}
      <ChevronRight className="h-4 w-4" />
    </Link>
  )
}

export function SecondaryButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-6 py-3 font-bold text-white hover:border-amber-400/50 hover:bg-amber-400/10"
    >
      {children}
    </Link>
  )
}

function MiniChart({ bearish = false, range = false }: { bearish?: boolean; range?: boolean }) {
  const bars = range
    ? [36, 42, 35, 44, 38, 43, 39, 41, 36, 45, 40, 42]
    : bearish
      ? [70, 62, 68, 55, 48, 52, 42, 36, 32, 28, 24, 20]
      : [24, 32, 28, 40, 46, 43, 52, 58, 54, 66, 72, 78]

  return (
    <div className="relative h-36 overflow-hidden rounded-xl border border-white/10 bg-slate-950/70 p-4">
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:32px_32px]" />
      <div className="relative flex h-full items-end gap-2">
        {bars.map((height, index) => (
          <div
            key={index}
            className={`w-full rounded-t ${
              range
                ? 'bg-amber-400/70'
                : bearish
                  ? index % 2 === 0
                    ? 'bg-rose-500'
                    : 'bg-emerald-500'
                  : index % 3 === 0
                    ? 'bg-rose-500'
                    : 'bg-emerald-500'
            }`}
            style={{ height: `${height}%` }}
          />
        ))}
      </div>
      {!range && (
        <>
          <div className="absolute left-16 top-7 rounded bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
            BOS
          </div>
          <div className="absolute bottom-7 right-7 rounded bg-sky-500/15 px-2 py-0.5 text-[10px] font-bold text-sky-300">
            Entry Zone
          </div>
        </>
      )}
    </div>
  )
}

export function MembershipPage() {
  const features = [
    ['Premium Indicators', 'Advanced tools for structure, liquidity, order flow, and key levels.', BarChart3],
    ['Real-Time Educational Alerts', 'High-probability setups with entry zones, targets, and reasoning.', Bell],
    ['Education & Guides', 'Step-by-step courses, strategy breakdowns, and setup guides.', GraduationCap],
    ['Community Access', 'Built for serious traders who want structure and discipline.', Users],
    ['Member Resources', 'Downloads, playbooks, checklists, and member-only content.', Lock],
  ]

  const plans = [
    { name: 'Monthly', price: '$69', sub: '/month', badge: '', bullets: ['Full access to indicators', 'Educational alerts', 'Academy and guides', 'Member resources'] },
    { name: 'Yearly', price: '$597', sub: '/year', badge: 'BEST VALUE', bullets: ['Full access to indicators', 'Educational alerts', 'Academy and guides', 'Member resources'] },
    { name: 'Lifetime', price: '$1,497', sub: 'one-time', badge: '', bullets: ['Full access to indicators', 'Educational alerts', 'Academy and guides', 'Member resources'] },
  ]

  return (
    <MarketingShell active="membership">
      <section className="mx-auto grid max-w-7xl gap-10 px-5 py-14 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          <Badge>The Complete Trading Advantage</Badge>
          <h1 className="max-w-xl text-5xl font-black leading-tight md:text-6xl">
            All-in-One Membership. Everything You Need. <span className={gold}>One Powerful Edge.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">
            MarketBOS Algo Prime gives you indicators, educational alerts, expert education, and member tools in one membership built around structure, confidence, and consistency.
          </p>
          <div className="mt-7 space-y-3 text-sm text-slate-300">
            {['Save time with proven tools', 'Get high-probability educational alerts', 'Master the strategy with step-by-step training', 'Stay focused and consistent'].map((item) => (
              <div key={item} className="flex items-center gap-3">
                <CheckCircle2 className="h-4 w-4 text-amber-400" />
                {item}
              </div>
            ))}
          </div>
          <div className="mt-8 flex flex-wrap gap-4">
            <PrimaryButton href="/membership">Join MarketBOS Algo Prime</PrimaryButton>
            <SecondaryButton href="#inside">See What’s Inside</SecondaryButton>
          </div>
        </div>

        <div className={softCard + ' p-5'}>
          <div className="mb-4 grid grid-cols-3 gap-3 text-xs">
            <div className="rounded-lg border border-white/10 bg-black/30 p-3">
              <span className="text-slate-400">Select Market</span>
              <div className="font-bold">MES1!</div>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/30 p-3">
              <span className="text-slate-400">Timeframe</span>
              <div className="font-bold">15m</div>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/30 p-3">
              <span className="text-slate-400">Candle Type</span>
              <div className="font-bold">Heikin Ashi</div>
            </div>
          </div>
          <MiniChart />
          <div className="mt-4 grid gap-4 md:grid-cols-5">
            {['Bullish BOS', 'Strong', 'Uptrend', 'Sweep', 'Low Risk'].map((item, index) => (
              <div key={item} className="rounded-lg border border-white/10 bg-black/30 p-3 text-center">
                <div className="text-xs text-slate-400">{['Structure', 'Momentum', 'Trend', 'Liquidity', 'Risk'][index]}</div>
                <div className="mt-1 text-sm font-bold text-emerald-400">{item}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="inside" className="mx-auto max-w-7xl px-5 pb-8">
        <div className={card + ' p-6'}>
          <h2 className="text-center text-3xl font-black">
            Everything You Need. <span className={gold}>All in One Place.</span>
          </h2>
          <div className="mt-8 grid gap-4 md:grid-cols-5">
            {features.map(([title, text, Icon]) => (
              <div key={title as string} className="rounded-xl border border-white/10 bg-white/[0.03] p-5 text-center">
                <Icon className="mx-auto h-9 w-9 text-amber-400" />
                <h3 className="mt-4 font-bold">{title as string}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-400">{text as string}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-6 px-5 py-8 lg:grid-cols-[1.35fr_0.65fr]">
        <div className={card + ' p-6'}>
          <h2 className="text-2xl font-black">Choose Your Plan</h2>
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            {plans.map((plan) => (
              <div key={plan.name} className={`relative rounded-2xl border p-5 ${plan.badge ? 'border-amber-400 bg-amber-400/5' : 'border-white/10 bg-white/[0.03]'}`}>
                {plan.badge && <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded bg-amber-400 px-3 py-1 text-xs font-black text-black">{plan.badge}</div>}
                <div className="font-bold">{plan.name}</div>
                <div className="mt-4 text-4xl font-black">{plan.price}<span className="text-sm font-normal text-slate-400"> {plan.sub}</span></div>
                <div className="mt-5 space-y-3 text-sm text-slate-300">
                  {plan.bullets.map((bullet) => (
                    <div key={bullet} className="flex gap-2">
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-amber-400" /> {bullet}
                    </div>
                  ))}
                </div>
                <button className="mt-6 w-full rounded-lg border border-amber-400/40 px-4 py-3 font-bold hover:bg-amber-400 hover:text-black">Get Started</button>
              </div>
            ))}
          </div>
        </div>

        <div className={card + ' p-6'}>
          <h2 className="text-2xl font-black">Why Traders Choose <span className={gold}>MarketBOS Algo Prime</span></h2>
          <div className="mt-6 space-y-5">
            {[
              ['Complete Trading System', 'Indicators, alerts, education, and member resources.'],
              ['Structure-Based Approach', 'Built around market structure, liquidity, and momentum.'],
              ['Built for All Traders', 'Simple enough to learn, deep enough to grow.'],
              ['Cancel Anytime', 'No long-term contracts. You stay in control.'],
            ].map(([title, text]) => (
              <div key={title} className="flex gap-4">
                <ShieldCheck className="h-6 w-6 shrink-0 text-amber-400" />
                <div>
                  <h3 className="font-bold">{title}</h3>
                  <p className="text-sm leading-6 text-slate-400">{text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 pb-14">
        <div className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-8 md:flex md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-black">Stop Guessing. Start Trading with Confidence.</h2>
            <p className="mt-2 text-slate-300">Join members who use MarketBOS Algo Prime to trade smarter, not harder.</p>
          </div>
          <div className="mt-5 md:mt-0">
            <PrimaryButton href="/membership">Join MarketBOS Algo Prime Today</PrimaryButton>
          </div>
        </div>
      </section>
    </MarketingShell>
  )
}

export function IndicatorsPage() {
  const filters = ['All', 'Structure', 'Liquidity', 'Momentum', 'Risk', 'AI/Quant']
  const indicators = [
    ['MarketBOS Structure Engine', 'Detects BOS, CHoCH, MSS and swing structure in real-time.', 'BOS/CHoCH', 'Best for Trend Continuation', false],
    ['MarketBOS Ghost Candles', 'Projects future price action using continuation and reaction levels.', 'Projection', 'Best for Continuation Trades', false],
    ['MarketBOS Liquidity Engine', 'Highlights sweeps, order blocks, and premium liquidity reaction zones.', 'Liquidity', 'Best for Reversals & Reactions', false],
    ['MarketBOS Momentum Matrix', 'Confirms trend strength and momentum with multi-factor signals.', 'Momentum', 'Best for Trend Confirmation', false],
    ['MarketBOS VWAP Scalper', 'VWAP-based intraday entries with trend filters and session awareness.', 'VWAP', 'Best for Intraday Scalping', false],
    ['MarketBOS Risk Zones', 'Plots smart entry, invalidation, and target zones for risk management.', 'Risk', 'Best for Risk Management', true],
    ['MarketBOS Quant Bias', 'AI/quant model that evaluates market conditions and directional bias.', 'AI Model', 'Best for Directional Bias', false],
    ['MarketBOS Sideways Filter', 'Identifies chop, low-quality conditions, and range-bound markets.', 'Chop Filter', 'Best for Market Filtering', true],
  ]

  return (
    <MarketingShell active="indicators">
      <section className="mx-auto grid max-w-7xl gap-10 px-5 py-12 lg:grid-cols-[0.85fr_1.15fr]">
        <div>
          <Badge>Custom Indicator Suite</Badge>
          <h1 className="text-5xl font-black leading-tight md:text-6xl">
            Trade Market Structure with <span className={gold}>Premium Indicators.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">
            Our custom indicator suite is built to help you read structure, track liquidity, confirm momentum, and manage risk with precision.
          </p>
          <div className="mt-8 flex flex-wrap gap-4">
            <PrimaryButton href="/membership">Join Membership</PrimaryButton>
            <SecondaryButton href="/academy">View Setup Guides</SecondaryButton>
          </div>
        </div>
        <MiniChart />
      </section>

      <section className="mx-auto max-w-7xl px-5">
        <div className="mb-6 flex flex-wrap justify-center gap-3">
          {filters.map((filter, index) => (
            <button key={filter} className={`rounded-lg border px-5 py-2 text-sm font-semibold ${index === 0 ? 'border-amber-400 bg-amber-400/10 text-amber-300' : 'border-white/10 text-slate-300 hover:border-amber-400/50'}`}>
              {filter}
            </button>
          ))}
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {indicators.map(([title, text, tag, best, bearish], index) => (
            <div key={title as string} className={card + ' overflow-hidden p-5'}>
              <div className="flex items-start justify-between gap-4">
                <BarChart3 className="h-8 w-8 text-amber-400" />
                <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs font-bold text-amber-300">
                  Included in Membership
                </div>
              </div>
              <h3 className="mt-4 text-xl font-black">{title as string}</h3>
              <p className="mt-2 min-h-[70px] text-sm leading-6 text-slate-400">{text as string}</p>
              <div className="my-4">
                <MiniChart bearish={Boolean(bearish)} range={index === 7} />
              </div>
              <div className="mb-4 flex flex-wrap gap-2">
                {[tag as string, 'Guide Included', 'Alerts'].map((item) => (
                  <span key={item} className="rounded bg-white/10 px-2 py-1 text-xs text-slate-300">{item}</span>
                ))}
              </div>
              <div className="border-t border-white/10 pt-3 text-sm font-bold text-amber-400">{best as string}</div>
            </div>
          ))}
        </div>

        <div className="my-10 grid gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-6 md:grid-cols-4">
          {[
            ['8+ Custom Indicators', 'Professionally engineered and designed for structure traders.'],
            ['Step-by-Step Guides', 'Detailed setup guides and real-world examples.'],
            ['High-Probability Setups', 'Built to identify, confirm, and execute quality trades.'],
            ['Built for Structure Traders', 'Created around market structure, liquidity, and momentum.'],
          ].map(([title, text]) => (
            <div key={title} className="flex gap-4">
              <Sparkles className="h-8 w-8 shrink-0 text-amber-400" />
              <div>
                <h3 className="font-bold">{title}</h3>
                <p className="mt-1 text-sm text-slate-400">{text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </MarketingShell>
  )
}

export function AcademyPage() {
  const categories = ['All', 'Beginner', 'Structure', 'Indicators', 'Setups', 'Risk', 'Psychology']
  const guides = [
    ['Trading Foundations', 'Learn the basics of trading, market participants, order types, and how to read price like a pro.', '12 Lessons', 'Beginner Friendly'],
    ['Market Structure Basics', 'Understand BOS, CHoCH, MSS, swing highs/lows, trends, and how structure drives the markets.', '18 Lessons', 'Most Popular'],
    ['BOS / CHoCH / MSS Guide', 'Complete breakdown of market structure shifts with real examples and scenario training.', '20 Lessons', 'Guide Included'],
    ['Liquidity Sweeps & Order Blocks', 'Learn how institutions trap liquidity and where smart money places high-probability orders.', '16 Lessons', 'Guide Included'],
    ['How to Use MarketBOS Indicators', 'Full walkthrough of all premium indicators, settings, and best use cases.', '22 Lessons', 'Step-by-Step'],
    ['VWAP, RSI, TSI & Momentum Guides', 'Master key momentum and mean-reversion tools for trend and reversal confirmation.', '15 Lessons', 'Guide Included'],
    ['Tested High-Probability Setups', 'Breakouts, reversals, continuations, and pullback setups with exact entry/exit rules.', '24 Lessons', 'Most Popular'],
    ['Risk Management & Trading Psychology', 'Position sizing, R:R, journaling, and building a winning mindset.', '17 Lessons', 'Members Only'],
  ]

  return (
    <MarketingShell active="academy">
      <section className="mx-auto grid max-w-7xl gap-8 px-5 py-12 lg:grid-cols-[1fr_0.8fr_0.65fr]">
        <div>
          <Badge>Member Education Portal</Badge>
          <h1 className="text-5xl font-black leading-tight md:text-6xl">
            Learn the System. <span className={gold}>Master the Structure.</span>
          </h1>
          <p className="mt-5 text-lg leading-8 text-slate-300">
            Step-by-step education built for real traders. Get proven lessons, indicator guides, market structure education, tested setups, and trading discipline content.
          </p>
          <div className="mt-7 flex flex-wrap gap-4">
            <PrimaryButton href="#guides">Explore Guides</PrimaryButton>
            <SecondaryButton href="/membership">Join Membership</SecondaryButton>
          </div>
        </div>

        <div className={card + ' p-5'}>
          <h2 className="font-black text-amber-300">Academy Curriculum</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {[
              ['Beginner Foundations', 'Start with the essentials.'],
              ['Market Structure', 'BOS, CHoCH, MSS and liquidity.'],
              ['Indicator Guides', 'Master every premium indicator.'],
              ['Tested Setups', 'High-probability real examples.'],
              ['Risk Management', 'Protect capital and manage risk.'],
              ['Trading Psychology', 'Build discipline and consistency.'],
            ].map(([title, text]) => (
              <div key={title} className="flex gap-3 border-b border-white/10 pb-3">
                <BookOpen className="h-6 w-6 shrink-0 text-amber-400" />
                <div>
                  <h3 className="font-bold">{title}</h3>
                  <p className="text-xs text-slate-400">{text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <aside className="space-y-4">
          <div className={card + ' p-5'}>
            <h2 className="font-black text-amber-300">My Progress</h2>
            <div className="mt-4 h-3 overflow-hidden rounded-full bg-white/10">
              <div className="h-full w-[64%] rounded-full bg-amber-400" />
            </div>
            <div className="mt-4 flex justify-between text-sm text-slate-300">
              <span>Overall Progress</span><span className="font-bold text-emerald-400">64%</span>
            </div>
          </div>

          <div className={card + ' p-5'}>
            <h2 className="font-black text-amber-300">Downloadable PDF Guides</h2>
            <div className="mt-4 space-y-3">
              {['Market Structure Cheat Sheet', 'BOS / CHoCH / MSS Guide', 'Order Blocks Quick Reference', 'Risk Management Checklist'].map((item) => (
                <div key={item} className="flex items-center justify-between text-sm text-slate-300">
                  <span>{item}</span><Download className="h-4 w-4 text-amber-400" />
                </div>
              ))}
            </div>
          </div>
        </aside>
      </section>

      <section id="guides" className="mx-auto max-w-7xl px-5 pb-14">
        <div className="mb-6 flex flex-wrap gap-3">
          {categories.map((cat, index) => (
            <button key={cat} className={`rounded-lg border px-5 py-2 text-sm font-semibold ${index === 0 ? 'border-amber-400 bg-amber-400/10 text-amber-300' : 'border-white/10 text-slate-300 hover:border-amber-400/50'}`}>
              {cat}
            </button>
          ))}
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {guides.map(([title, text, lessons, tag], index) => (
            <div key={title} className={card + ' overflow-hidden p-5'}>
              <MiniChart bearish={index === 5} range={index === 7} />
              <div className="mt-4 flex items-center justify-between">
                <h3 className="text-xl font-black">{title}</h3>
                <span className="rounded bg-amber-400/10 px-2 py-1 text-[10px] font-bold text-amber-300">{tag}</span>
              </div>
              <p className="mt-2 min-h-[72px] text-sm leading-6 text-slate-400">{text}</p>
              <div className="mt-4 flex items-center gap-2 text-sm text-slate-400">
                <BookOpen className="h-4 w-4 text-amber-400" /> {lessons}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-7 md:flex md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-black">Unlock Full Access with <span className={gold}>MarketBOS Algo Prime</span></h2>
            <p className="mt-2 text-slate-300">Get unlimited access to all guides, indicators, alerts, and member tools.</p>
          </div>
          <div className="mt-5 md:mt-0">
            <PrimaryButton href="/membership">Join MarketBOS Algo Prime</PrimaryButton>
          </div>
        </div>
      </section>
    </MarketingShell>
  )
}

export function ShopPage() {
  const products = [
    ['MarketBOS Desk Mat', 'Premium large desk mat with key liquidity and structure cheat sheet.', '$39.99', 'BEST SELLER'],
    ['The Market Structure Handbook', 'The complete guide to reading structure, liquidity, and price.', '$49.99', 'BEST SELLER'],
    ["Trader's Journal", 'Plan, execute, and review your trades. Stay consistent.', '$29.99', 'NEW'],
    ['Market Structure Pattern Cards', '52 high-probability patterns in a pocket-sized format.', '$24.99', 'POPULAR'],
    ['MarketBOS Cheat Sheet Poster', 'All-in-one reference for structure, liquidity, BOS, CHoCH and more.', '$19.99', 'NEW'],
  ]

  return (
    <MarketingShell active="shop">
      <section className="mx-auto grid max-w-7xl gap-10 px-5 py-12 lg:grid-cols-[0.85fr_1.15fr]">
        <div>
          <Badge>Tools That Elevate Your Edge</Badge>
          <h1 className="text-5xl font-black leading-tight md:text-6xl">
            Built for Traders. <span className={gold}>Designed for Focus.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">
            Premium trading tools, books, journals, and resources created to keep you focused, organized, and one step ahead.
          </p>
          <div className="mt-10 grid grid-cols-2 gap-6 md:grid-cols-4">
            {[
              ['Premium Quality', ShieldCheck],
              ['Fast Shipping', Package],
              ['Trader Approved', CheckCircle2],
              ['Designed by Traders', Sparkles],
            ].map(([title, Icon]) => (
              <div key={title as string}>
                <Icon className="h-8 w-8 text-amber-400" />
                <h3 className="mt-3 text-sm font-bold">{title as string}</h3>
              </div>
            ))}
          </div>
        </div>

        <div className={softCard + ' p-6'}>
          <div className="grid gap-4 md:grid-cols-3">
            {['The Market Structure Handbook', 'Journal', 'Pattern Cards'].map((item, index) => (
              <div key={item} className={`rounded-2xl border border-amber-400/20 bg-black/40 p-6 ${index === 1 ? 'md:translate-y-10' : ''}`}>
                <div className="flex h-48 items-center justify-center rounded-xl bg-gradient-to-br from-slate-900 to-black text-center text-xl font-black text-amber-300">
                  {item}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 pb-14">
        <div className="mb-8 grid gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3 md:grid-cols-7">
          {['All Products', 'Desk Mats', 'Books & Guides', 'Journals', 'Pattern Cards', 'Digital Products', 'Accessories'].map((cat, index) => (
            <button key={cat} className={`rounded-xl px-4 py-4 text-sm font-semibold ${index === 0 ? 'bg-amber-400/10 text-amber-300' : 'text-slate-300 hover:bg-white/5'}`}>
              {cat}
            </button>
          ))}
        </div>

        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-3xl font-black">Featured Products</h2>
          <SecondaryButton href="/shop">View All Products</SecondaryButton>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {products.map(([title, text, price, badge], index) => (
            <div key={title} className={card + ' overflow-hidden p-4'}>
              <div className="relative">
                <div className="flex h-52 items-center justify-center rounded-xl bg-gradient-to-br from-slate-900 to-black text-center text-lg font-black text-amber-300">
                  {title}
                </div>
                <div className="absolute left-3 top-3 rounded bg-amber-400 px-2 py-1 text-[10px] font-black text-black">{badge}</div>
              </div>
              <h3 className="mt-4 font-black">{title}</h3>
              <p className="mt-2 min-h-[64px] text-sm leading-6 text-slate-400">{text}</p>
              <div className="mt-3 text-xl font-black">{price}</div>
              <button className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-amber-400/40 px-4 py-3 font-bold text-amber-300 hover:bg-amber-400 hover:text-black">
                <ShoppingCart className="h-4 w-4" /> Add to Cart
              </button>
            </div>
          ))}
        </div>

        <div className="mt-8 grid gap-4 rounded-2xl border border-amber-400/20 bg-amber-400/5 p-6 md:grid-cols-4">
          {[
            ['Secure Checkout', 'Your payments are safe and encrypted.'],
            ['30-Day Returns', 'Not happy? Send it back within 30 days.'],
            ['Customer Support', 'We are here to help every step of the way.'],
            ['Worldwide Shipping', 'We ship to most countries around the world.'],
          ].map(([title, text]) => (
            <div key={title} className="flex gap-4">
              <ShieldCheck className="h-8 w-8 shrink-0 text-amber-400" />
              <div>
                <h3 className="font-bold">{title}</h3>
                <p className="text-sm text-slate-400">{text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </MarketingShell>
  )
}

export function TradingRoomPage() {
  return (
    <MarketingShell active="trading-room">
      <section className="mx-auto flex min-h-[calc(100vh-80px)] max-w-7xl items-center px-5 py-14">
        <div className="mx-auto w-full max-w-4xl text-center">
          <Badge>Premium Higher-Ticket Offer</Badge>
          <div className="rounded-3xl border border-amber-400/30 bg-gradient-to-br from-amber-400/10 via-slate-950 to-slate-950 p-10 shadow-2xl shadow-black/40">
            <Crown className="mx-auto h-20 w-20 text-amber-400" />
            <h1 className="mt-8 text-5xl font-black leading-tight md:text-7xl">
              Premium Trading Room
            </h1>
            <div className="mx-auto mt-6 inline-flex rounded-2xl border border-amber-400/50 bg-amber-400 px-8 py-4 text-2xl font-black text-black">
              COMING SOON
            </div>
            <p className="mx-auto mt-8 max-w-2xl text-lg leading-8 text-slate-300">
              This higher-ticket room will be separate from the all-in-one membership and built for live sessions, deeper breakdowns, Q&A, group coaching, and advanced structure-based trading reviews.
            </p>
            <div className="mt-10 grid gap-4 md:grid-cols-3">
              {[
                ['Live Sessions', Radio],
                ['Weekly Reviews', LineChart],
                ['Group Coaching', Users],
              ].map(([title, Icon]) => (
                <div key={title as string} className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
                  <Icon className="mx-auto h-8 w-8 text-amber-400" />
                  <h3 className="mt-3 font-bold">{title as string}</h3>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </MarketingShell>
  )
}
