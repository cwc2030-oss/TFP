import type { Metadata } from "next";
import { Inter, Crimson_Text } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { Providers } from "@/components/providers";
import LayoutWrapper from "@/components/layout-wrapper";
import CanonicalHead from "@/components/canonical-head";
import { FeatureFlagsProvider } from "@/components/feature-flags-provider";
import { isCountyDeerFlowEnabled } from "@/lib/deerflow-gate";

const inter = Inter({ subsets: ["latin"] });
const crimsonText = Crimson_Text({ subsets: ["latin"], weight: ["400", "600", "700"], variable: "--font-serif" });

export const dynamic = "force-dynamic";

// Use custom domain as the canonical base; falls back to Abacus domain
const SITE_URL = "https://terrafirma.partners";
const OG_IMAGE_URL = `${SITE_URL}/og-image.png`;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Terra Firma Partners™ | Land Intelligence | Missouri",
  description:
    "Land Intelligence for hunting and recreational property. Terrain-derived deer intel, CWD status, harvest pressure, flood zones, soil data & more. Unlock any parcel for $19, or go unlimited with Pro.",
  keywords: [
    "land intelligence", "hunting land report", "recreational land analysis", "CWD status Missouri", 
    "deer hunting property", "land analysis report", "harvest pressure data", "deer intel",
    "Missouri hunting land", "rural land report", "parcel analysis", "LiDAR terrain",
    "flood zone map", "soil report", "hunting acreage", "land buyer report",
    "trophy deer land", "recreational property Missouri", "hunting intelligence report"
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
    url: SITE_URL,
    siteName: "Terra Firma Partners™",
    title: "Terra Firma Partners™ | Land Intelligence",
    description:
      "Land Intelligence for hunting and recreational property. Terrain-derived deer intel, CWD status, harvest pressure, flood zones & soil data. Single-parcel unlock $19, or Pro unlimited.",
    images: [
      {
        url: OG_IMAGE_URL,
        width: 1200,
        height: 630,
        alt: "Terra Firma Partners - Land Intelligence",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Terra Firma Partners™ | Land Intelligence",
    description: "Land Intelligence for Missouri hunting and recreational property. Terrain-derived deer intel, CWD status, harvest data & more.",
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
        <CanonicalHead />
        <Script id="suppress-known-errors" strategy="beforeInteractive">
          {`
            (function() {
              var origError = console.error;
              console.error = function() {
                var msg = arguments[0];
                if (typeof msg === 'string' && msg.indexOf('data-hydration-error') !== -1) return;
                origError.apply(console, arguments);
              };
            })();
          `}
        </Script>
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
      <body className={`${inter.className} ${crimsonText.variable} antialiased`} suppressHydrationWarning>
        <Providers>
          <FeatureFlagsProvider
            value={{ countyDeerFlowEnabled: isCountyDeerFlowEnabled() }}
          >
            <LayoutWrapper>{children}</LayoutWrapper>
          </FeatureFlagsProvider>
        </Providers>
      </body>
    </html>
  );
}
