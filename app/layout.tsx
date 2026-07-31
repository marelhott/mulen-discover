import type { Metadata, Viewport } from "next";
import { Inter, Lora } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

const lora = Lora({
  variable: "--font-serif",
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://movie-releases.vercel.app";

export const viewport: Viewport = {
  themeColor: "#0f9f76",
};

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Film a novinky",
  description: "Filmové novinky, nové tituly a ověřené releasy na jednom místě.",
  openGraph: {
    title: "Film a novinky",
    description: "Filmové novinky, nové tituly a ověřené releasy na jednom místě.",
    type: "website",
    url: siteUrl,
  },
  twitter: {
    card: "summary_large_image",
    title: "Film a novinky",
    description: "Filmové novinky, nové tituly a ověřené releasy na jednom místě.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="cs" className={`${inter.variable} ${lora.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
