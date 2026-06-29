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
  // Default to visible so SSR/initial paint shows content immediately.
  // Only hide-then-fade if the element is actually below the fold on mount.
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof window === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const rect = el.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    // If already on screen, leave it visible — no fade.
    if (rect.top < vh && rect.bottom > 0) return;
    // Below the fold: hide and observe for scroll-in.
    setInView(false);
    const fallback = window.setTimeout(() => setInView(true), 1500 + delay);
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          window.setTimeout(() => setInView(true), delay);
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