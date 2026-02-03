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
  title: "Terra Firma Partners™ | Professional Land Analysis Reports",
  description:
    "Get instant land parcel analysis reports for any property in the USA. Flood zones, topography, soil types, ownership data & more. Professional PDF reports for $350.",
  keywords: ["land analysis", "parcel report", "property report", "flood zone map", "land survey", "real estate analysis", "FEMA flood", "topography map", "soil report"],
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
    title: "Terra Firma Partners™ | Professional Land Analysis Reports",
    description:
      "Get instant land parcel analysis reports for any US property. Flood zones, topography, soil, ownership & more. $350 per report.",
    images: [
      {
        url: OG_IMAGE_URL,
        width: 1200,
        height: 630,
        alt: "Terra Firma Partners - Land Analysis Reports",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Terra Firma Partners™ | Land Analysis Reports",
    description: "Professional land parcel analysis reports for any US property. $350 per report.",
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
