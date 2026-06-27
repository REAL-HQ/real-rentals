import { useEffect, useRef, useState, type ReactNode } from "react";

export function FadeUp({
  children,
  className = "",
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Respect reduced motion and show immediately.
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setInView(true);
      return;
    }
    // If already in the viewport on mount (e.g. above-the-fold hero,
    // bfcache restore, fast reload), reveal right away. IntersectionObserver
    // can otherwise miss the initial intersection during hydration.
    const rect = el.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const vw = window.innerWidth || document.documentElement.clientWidth;
    if (rect.top < vh && rect.bottom > 0 && rect.left < vw && rect.right > 0) {
      const id = window.setTimeout(() => setInView(true), delay);
      return () => window.clearTimeout(id);
    }
    // Safety net: if the observer never fires for any reason, reveal after 1.5s.
    const fallback = window.setTimeout(() => setInView(true), 1500 + delay);
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setTimeout(() => setInView(true), delay);
          window.clearTimeout(fallback);
          obs.disconnect();
        }
      },
      { threshold: 0.12 }
    );
    obs.observe(el);
    return () => {
      window.clearTimeout(fallback);
      obs.disconnect();
    };
  }, [delay]);
  return (
    <div ref={ref} className={`fade-up ${inView ? "in-view" : ""} ${className}`}>
      {children}
    </div>
  );
}