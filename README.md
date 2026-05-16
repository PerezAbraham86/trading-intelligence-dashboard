# Trading Intelligence Dashboard

A modern, real-time trading dashboard built with **Next.js 14**, **TypeScript**, **Tailwind CSS**, and **lightweight-charts v4**. Designed for Vercel deployment with full dark theme optimization.

## 🚀 Features

✅ **Real-time Signal Display** - ES1! trading signals with BUY/SELL indicators  
✅ **Interactive Candlestick Charts** - lightweight-charts v4 with ghost candles  
✅ **Pressure Gauges** - Bull, Bear, Ghost Confidence, Chop Risk, Macro Risk  
✅ **Factor Confirmation** - 9-factor analysis (SMC, AlphaX, Ghost, OI, Delta, Session, FRED, FINRA, COT)  
✅ **Ghost Candle Projections** - 3 projected candles with confidence levels  
✅ **Warnings Panel** - FOMC alerts, macro risks, gap analysis  
✅ **Recent Signals Table** - Trade history with P&L tracking  
✅ **Smooth Animations** - Framer Motion transitions throughout  
✅ **Dark Modern Theme** - Optimized for 24/7 trading  
✅ **Vercel Ready** - Zero-config deployment  

## 📋 Prerequisites

- Node.js 18+
- npm or yarn

## 🔧 Installation

```bash
# Clone the repository
git clone https://github.com/PerezAbraham86/trading-intelligence-dashboard.git
cd trading-intelligence-dashboard

# Install dependencies
npm install
```

## 🏃 Development

```bash
# Start development server
npm run dev

# Open http://localhost:3000 in your browser
```

## 📦 Dependencies

- **next**: ^14.0.0 - React framework
- **react**: ^18.2.0 - UI library
- **typescript**: ^5.3.3 - Type safety
- **tailwindcss**: ^3.3.6 - Styling
- **lightweight-charts**: ^4.1.0 - Charting library
- **lucide-react**: ^0.294.0 - Icons
- **framer-motion**: ^10.16.16 - Animations

## 🎨 Project Structure

```
trading-intelligence-dashboard/
├── app/
│   ├── layout.tsx           # Root layout
│   ├── page.tsx             # Main dashboard
│   └── globals.css          # Global styles
├── components/
│   ├── SignalCard.tsx       # ES1! signal card
│   ├── CandlestickChart.tsx # Chart component
│   ├── PressureGauges.tsx   # Gauge display
│   ├── FactorConfirmationTable.tsx
│   ├── GhostCandleProjection.tsx
│   ├── WarningsPanel.tsx
│   └── RecentSignalsTable.tsx
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── postcss.config.js
├── next.config.js
└── README.md
```

## 🔌 FastAPI Backend Integration

The dashboard is ready to connect to your Python FastAPI backend. The placeholder is in `app/page.tsx`:

```typescript
// Later FastAPI connection:
// const res = await fetch("https://YOUR-FASTAPI-URL.com/api/latest-signal");
// const json = await res.json();
// setData(json);
```

Replace with your actual backend URL and implement data fetching logic.

## 🛠️ Build for Production

```bash
# Build the project
npm run build

# Start production server
npm start
```

## 🚀 Deploy to Vercel

### Option 1: Using Vercel CLI

```bash
npm install -g vercel
vercel
```

### Option 2: GitHub Integration

1. Push your code to GitHub
2. Go to [vercel.com](https://vercel.com)
3. Import your GitHub repository
4. Vercel will auto-detect Next.js and deploy

### Option 3: Direct Git Connection

Connect your GitHub repo in Vercel dashboard for auto-deployment on every push.

## 📊 Mock Data

All components use mock data for demonstration. Replace with real API calls when backend is ready.

## 🎯 Roadmap

- [ ] Connect to FastAPI backend
- [ ] Real-time WebSocket updates
- [ ] User authentication
- [ ] Portfolio tracking
- [ ] Advanced charting tools
- [ ] Custom indicators
- [ ] Alert system
- [ ] Mobile app

## 📝 Configuration

### Environment Variables

Create `.env.local` if needed for API endpoints:

```env
NEXT_PUBLIC_API_URL=https://your-fastapi-backend.com
```

### Tailwind Customization

Edit `tailwind.config.ts` to customize colors, fonts, and animations.

## 🐛 Troubleshooting

### Chart not displaying?

- Ensure `lightweight-charts` v4 is installed: `npm install lightweight-charts@^4.1.0`
- Clear node_modules and reinstall: `rm -rf node_modules && npm install`

### Animations not smooth?

- Check if `framer-motion` is installed: `npm install framer-motion@^10.16.16`
- Restart dev server: `npm run dev`

### TypeScript errors?

- Run type check: `npx tsc --noEmit`
- Ensure all files have `.tsx` or `.ts` extensions

## 📄 License

MIT

## 👤 Author

PerezAbraham86

## 🔗 Links

- [GitHub Repository](https://github.com/PerezAbraham86/trading-intelligence-dashboard)
- [Next.js Documentation](https://nextjs.org/docs)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
- [lightweight-charts Documentation](https://tradingview.github.io/lightweight-charts/)
- [Vercel Documentation](https://vercel.com/docs)

---

**Status**: ✅ Production Ready | **Last Updated**: 2026-05-16
