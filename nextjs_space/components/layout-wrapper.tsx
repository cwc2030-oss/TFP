/**
 * Layout Wrapper - Conditionally renders Navbar/Footer
 * Pages like /intel and /viewer should not show global chrome
 */
'use client';

import { usePathname } from 'next/navigation';
import Navbar from './navbar';
import Footer from './footer';

const FULLSCREEN_PATHS = ['/intel', '/viewer', '/preview'];

export default function LayoutWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isFullscreen = FULLSCREEN_PATHS.some(p => pathname?.startsWith(p));

  if (isFullscreen) {
    return <>{children}</>;
  }

  return (
    <>
      <Navbar />
      {children}
      <Footer />
    </>
  );
}
