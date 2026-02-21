'use client';

import { usePathname } from 'next/navigation';
import Navbar from '@/components/navbar';
import Footer from '@/components/footer';

// Pages that use full-screen immersive layout (no Navbar/Footer)
const IMMERSIVE_PAGES = ['/intel'];

export default function LayoutWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isImmersive = IMMERSIVE_PAGES.some(p => pathname?.startsWith(p));

  if (isImmersive) {
    // Full-screen layout - no chrome
    return <>{children}</>;
  }

  // Standard layout with Navbar + Footer
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
