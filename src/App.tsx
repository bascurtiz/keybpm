import { useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { Header } from '@/components/Header'
import { Home } from '@/pages/Home'
import { Browse } from '@/pages/Browse'
import { TrackDetail } from '@/pages/TrackDetail'
import { KeyWheelPage } from '@/pages/KeyWheelPage'
import { MixFinder } from '@/pages/MixFinder'
import { About } from '@/pages/About'
import { KeyTool } from '@/pages/KeyTool'
import { Contribute } from '@/pages/Contribute'
import { Review } from '@/pages/Review'
import { EmptyState } from '@/components/EmptyState'
import { Toast } from '@/components/Toast'
import { Link } from 'react-router-dom'

/** Reset scroll on navigation — SPA routes don't do this natively. */
function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

function NotFound() {
  useEffect(() => {
    document.title = 'Not found — KeyBPM'
  }, [])
  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <EmptyState
        title="404 — Page not found"
        hint="The page you're looking for doesn't exist."
        action={<Link to="/" className="btn-primary">Go home</Link>}
      />
    </div>
  )
}

export default function App() {
  return (
    <div className="min-h-screen">
      <ScrollToTop />
      <Header />
      <Toast />
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/browse" element={<Browse />} />
          <Route path="/track/:id" element={<TrackDetail />} />
          <Route path="/contribute" element={<Contribute />} />
          <Route path="/review" element={<Review />} />
          <Route path="/key" element={<KeyWheelPage />} />
          <Route path="/key/:camelot" element={<KeyWheelPage />} />
          <Route path="/camelot/:camelot" element={<KeyWheelPage />} />
          <Route path="/mix" element={<MixFinder />} />
          <Route path="/mix/:camelot" element={<MixFinder />} />
          <Route path="/mix/:camelot/:bpm" element={<MixFinder />} />
          <Route path="/tool" element={<KeyTool />} />
          <Route path="/about" element={<About />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <AppFooter />
    </div>
  )
}

/** Hide footer on Key Tool so 1080p can show the full tool without scrolling. */
function AppFooter() {
  const { pathname } = useLocation()
  if (pathname === '/tool') return null
  return (
    <footer className="mt-12 border-t border-line">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-2 px-4 pt-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] text-xs text-text-dim lg:px-8">
        <span className="font-mono">KeyBPM — open music Key &amp; BPM database</span>
        <span>
          Data: duuzu&apos;s key &amp; bpm database v10 · <Link to="/about" className="underline underline-offset-2 hover:text-text-muted">About &amp; data notes</Link>
        </span>
      </div>
    </footer>
  )
}
