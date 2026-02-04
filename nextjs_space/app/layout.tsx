import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { Providers } from "@/components/providers";
import Navbar from "@/components/navbar";
import Footer from "@/components/footer";

const inter = Inter({ subsets: ["latin"] });

export const dynamic = "force-dynamic";

const OG_IMAGE_URL = "https://terrafirmapartners.abacusai.app/og-image.png";

export const metadata: Metadata = {
  metadataBase: new URL("https://terrafirmapartners.abacusai.app"),
  title: "Terra Firma Partners™ | Hunting Land Analysis Reports | Missouri",
  description:
    "Professional land analysis for hunting and recreational property buyers. CWD status, harvest pressure, drought conditions, flood zones, soil data & more. Know the land before you buy. $350 per report.",
  keywords: [
    "hunting land report", "recreational land analysis", "CWD status Missouri", 
    "deer hunting property", "land analysis report", "harvest pressure data",
    "Missouri hunting land", "rural land report", "parcel analysis", 
    "flood zone map", "soil report", "hunting acreage", "land buyer report",
    "trophy deer land", "recreational property Missouri"
  ],
  authors: [{ name: "Terra Firma Partners LLC" }],
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/favicon.svg",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://terrafirmapartners.abacusai.app",
    siteName: "Terra Firma Partners™",
    title: "Terra Firma Partners™ | Hunting Land Analysis Reports",
    description:
      "Know the land before you buy. CWD status, harvest pressure, drought, flood zones & soil data for hunting and recreational property. $350 per report.",
    images: [
      {
        url: OG_IMAGE_URL,
        width: 1200,
        height: 630,
        alt: "Terra Firma Partners - Hunting Land Analysis Reports",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Terra Firma Partners™ | Hunting Land Reports",
    description: "CWD status, harvest pressure, drought & flood data for hunting land buyers. $350 per report.",
    images: [OG_IMAGE_URL],
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script src="https://apps.abacus.ai/chatllm/appllm-lib.js"></script>
        {process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID && (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID}`}
              strategy="afterInteractive"
            />
            <Script id="google-analytics" strategy="afterInteractive">
              {`
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', '${process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID}');
              `}
            </Script>
          </>
        )}
      </head>
      <body className={`${inter.className} antialiased`} suppressHydrationWarning>
        <Providers>
          <div className="min-h-screen flex flex-col">
            <Navbar />
            <main className="flex-1">{children}</main>
            <Footer />
          </div>
        </Providers>
      </body>
    </html>
  );
}
