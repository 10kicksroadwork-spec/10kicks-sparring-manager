import type { Metadata, Viewport } from "next";
import { Barlow_Condensed, Source_Sans_3 } from "next/font/google";
import "./globals.css";

const display = Barlow_Condensed({ subsets: ["latin"], weight: ["500", "700"], variable: "--font-barlow" });
const sans = Source_Sans_3({ subsets: ["latin"], weight: ["400", "600", "700"], variable: "--font-source" });

export const metadata: Metadata = {
  title: "10 Kicks Sparring Manager",
  description: "Saturday hard-sparring rundown for 10 Kicks coaches.",
  applicationName: "10 Kicks Sparring Manager",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0c0c0c",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} h-full`}>
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}
