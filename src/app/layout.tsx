import type { Metadata } from "next";
import { DM_Sans, IBM_Plex_Sans, IBM_Plex_Serif } from "next/font/google";
import "./globals.css";
import { AppToaster } from "@/components/ui/app-toaster";
import { Providers } from "@/components/providers";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const plexSerif = IBM_Plex_Serif({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-serif",
  display: "swap",
});

// ponytail: reader-body sans house style. App chrome stays on DM Sans; this is
// self-hosted solely so the epub iframe can clone its @font-face at runtime
// (see house-styles.ts). Same weights/styles as Plex Serif for parity.
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-plex-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Nutshell",
  description: "AI-powered ebook reader for deep understanding",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${dmSans.variable} ${plexSerif.variable} ${plexSans.variable} font-sans antialiased`}>
        <Providers>
          {children}
          <AppToaster />
        </Providers>
      </body>
    </html>
  );
}
