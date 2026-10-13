import { useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { Header } from '@/components/Header'
import { Home } from '@/pages/Home'
import { Browse } from '@/pages/Browse'
import { TrackDetail } from '@/pages/TrackDetail'
import { SourcePage } from '@/pages/SourcePage'
import { KeyWheelPage } from '@/pages/KeyWheelPage'
import { MixFinder } from '@/pages/MixFinder'
import { About } from '@/pages/About'
import { KeyTool } from '@/pages/KeyTool'
import { MixIt } from '@/pages/MixIt'
import { Contribute } from '@/pages/Contribute'
import { Review } from '@/pages/Review'
import { EmptyState } from '@/components/EmptyState'
import { Toast } from '@/components/Toast'
import { Link } from 'react-router-dom'

/**
 * Reset scroll on navigation — SPA routes don't do this natively.
 *
 * A hash is an exception: it means the route is opening on a specific row (a
 * source listing deep-link, `/source/camelotsound#<track-id>`), and the page
 * scrolls itself there. Yanking it back to the top would land the user at the
 * wrong end of a 35k-row listing.
 */
function ScrollToTop() {
  const { pathname, hash } = useLocation()
  useEffect(() => {
    if (!hash) window.scrollTo(0, 0)
  }, [pathname, hash])
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
  const { pathname } = useLocation()

  return (
    <div className="min-h-screen">
      <ScrollToTop />
      <Header />
      <Toast />
      <main>
        {/* Keyed by pathname so a page change re-mounts and replays the
            fade-in; query-only changes (e.g. /mix?track=…) keep the same page. */}
        <div key={pathname} className="page-fade">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/browse" element={<Browse />} />
            <Route path="/track/:id" element={<TrackDetail />} />
            <Route path="/source/:id" element={<SourcePage />} />
            <Route path="/contribute" element={<Contribute />} />
            <Route path="/review" element={<Review />} />
            <Route path="/key" element={<KeyWheelPage />} />
            <Route path="/key/:camelot" element={<KeyWheelPage />} />
            <Route path="/camelot/:camelot" element={<KeyWheelPage />} />
            <Route path="/mix" element={<MixFinder />} />
            <Route path="/mix/:camelot" element={<MixFinder />} />
            <Route path="/mix/:camelot/:bpm" element={<MixFinder />} />
            <Route path="/tool" element={<KeyTool />} />
            <Route path="/mix-it" element={<MixIt />} />
            <Route path="/about" element={<About />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </div>
      </main>
      <AppFooter />
    </div>
  )
}

/** Hide footer on Key Tool and Mix it so 1080p can show the full console without scrolling. */
function AppFooter() {
  const { pathname } = useLocation()
  if (pathname === '/tool' || pathname === '/mix-it') return null
  return (
    <footer className="mt-12 border-t border-line">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-2 px-4 pt-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] text-xs text-text-dim lg:px-8">
        <span className="font-mono">KeyBPM — open music Key &amp; BPM database</span>
        <span className="flex items-center gap-2">
          Data: duuzu&apos;s key &amp; bpm database v10 · <Link to="/about" className="underline underline-offset-2 hover:text-text-muted">About &amp; data notes</Link>
          <a
            href="https://github.com/bascurtiz/keybpm"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="KeyBPM on GitHub"
            title="View the source on GitHub"
            className="text-text-dim transition-colors hover:text-text"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="currentColor"
              aria-hidden
            >
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
            </svg>
          </a>
        </span>
      </div>
    </footer>
  )
}
