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
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setTimeout(() => setInView(true), delay);
          obs.disconnect();
        }
      },
      { threshold: 0.12 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [delay]);
  return (
    <div ref={ref} className={`fade-up ${inView ? "in-view" : ""} ${className}`}>
      {children}
    </div>
  );
}