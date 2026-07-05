import type { ReactNode } from "react";
import { Nav } from "./Nav";
import { Footer } from "./Footer";

export function SiteLayout({ children, adMode = false }: { children: ReactNode; adMode?: boolean }) {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Nav adMode={adMode} />
      <main className="flex-1">{children}</main>
      <Footer adMode={adMode} />
    </div>
  );
}