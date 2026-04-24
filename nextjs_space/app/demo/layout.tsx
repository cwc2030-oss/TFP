import type { Metadata } from "next";

const SITE_URL = "https://terrafirma.partners";

export const metadata: Metadata = {
  title: "Demo | See What Your Land Is Hiding — Terra Firma Partners",
  description:
    "Explore real Missouri hunting properties with LiDAR-powered terrain analysis. See deer movement corridors, funnel zones, and intercept placements — then unlock your own parcel intel.",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: `${SITE_URL}/demo`,
    siteName: "Terra Firma Partners™",
    title: "See What Your Land Is Hiding — Free Terrain Demo",
    description:
      "Tap a property and watch LiDAR terrain analysis reveal deer movement corridors in real time. Try it free, then get your own Hunt Report.",
    images: [
      {
        url: `${SITE_URL}/og-demo.png`,
        width: 1200,
        height: 630,
        alt: "Terra Firma Partners — Deer Movement Terrain Analysis Demo",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "See What Your Land Is Hiding — Free Terrain Demo",
    description:
      "LiDAR-powered deer movement analysis on real Missouri hunting properties. Try it free.",
    images: [`${SITE_URL}/og-demo.png`],
  },
};

export default function DemoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
