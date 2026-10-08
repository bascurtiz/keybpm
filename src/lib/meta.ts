import { useEffect } from 'react'

/**
 * Per-route document metadata for a static SPA: title, description,
 * Open Graph and canonical URL. Tags are created once and updated in place.
 */
function setMeta(attr: 'name' | 'property', key: string, content: string): void {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.content = content
}

function setCanonical(href: string): void {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (!el) {
    el = document.createElement('link')
    el.rel = 'canonical'
    document.head.appendChild(el)
  }
  el.href = href
}

export function usePageMeta(title: string, description?: string): void {
  useEffect(() => {
    document.title = title
    const url = window.location.origin + window.location.pathname
    setMeta('property', 'og:title', title)
    setMeta('property', 'og:url', url)
    setCanonical(url)
    if (description) {
      setMeta('name', 'description', description)
      setMeta('property', 'og:description', description)
    }
  }, [title, description])
}
