// Hash routing: deep links work on GitHub Pages and from file paths without server rewrites.
import { useEffect, useState } from 'react';

export function parseHash(h = window.location.hash): { path: string[]; query: URLSearchParams } {
  const raw = h.replace(/^#\/?/, '');
  const [p, q] = raw.split('?');
  return { path: p.split('/').filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(q ?? '') };
}

export function useRoute() {
  const [route, setRoute] = useState(parseHash());
  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function href(...parts: string[]): string {
  return '#/' + parts.map(encodeURIComponent).join('/');
}

export function navigate(...parts: string[]) {
  window.location.hash = href(...parts);
}
