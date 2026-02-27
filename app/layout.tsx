import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://link2book.afifzafri.com";

export const metadata: Metadata = {
  title: "Link2Book - Turn Web Links into EPUB Books",
  description: "Turn web links into clean, portable EPUB books. Save articles, blog posts, and web content as beautifully formatted ebooks.",
  keywords: ["epub converter", "web to epub", "save articles", "ebook maker", "read later", "web clipper"],
  authors: [{ name: "Link2Book" }],
  creator: "Link2Book",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: appUrl,
    title: "Link2Book - Turn Web Links into EPUB Books",
    description: "Turn web links into clean, portable EPUB books.",
    siteName: "Link2Book",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Link2Book Preview",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Link2Book - Turn Web Links into EPUB Books",
    description: "Turn web links into clean, portable EPUB books.",
    images: ["/og-image.png"],
  },
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/favicon-96x96.png", sizes: "96x96", type: "image/png" },
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/apple-touch-icon.png" }],
    other: [{ rel: "manifest", url: "/site.webmanifest" }],
  },
  metadataBase: new URL(appUrl),
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "Link2Book",
    description: "Turn web links into clean, portable EPUB books.",
    url: appUrl,
    applicationCategory: "UtilityApplication",
    operatingSystem: "Web",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
  };

  return (
    <html lang="en">
      <body className="antialiased text-gray-900 bg-gray-50 min-h-screen">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        {children}
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js"
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}
