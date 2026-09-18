import type { Metadata } from "next";
import {
  Inter,
  JetBrains_Mono,
  Lora,
  Playfair_Display,
} from "next/font/google";

import "./globals.css";

/**
 * The four families in the schema's closed font set.
 *
 * next/font downloads these at build time and serves them from our own origin,
 * which is what makes "self-hosted" true — and therefore what lets the Slice 5
 * PDF worker load the identical files. Each binds the CSS variable named in
 * `FONT_CSS_VARIABLES`; the schema's FONT_STACKS reference those variables, so
 * there is one mapping from family name to actual typeface.
 */
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});
const lora = Lora({
  subsets: ["latin"],
  variable: "--font-lora",
  display: "swap",
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});
const playfairDisplay = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Formcraft",
  description:
    "Design a form on a free canvas, publish it as a link, get submissions back as PDF, Excel or email.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${lora.variable} ${jetbrainsMono.variable} ${playfairDisplay.variable}`}
    >
      <body className="antialiased">{children}</body>
    </html>
  );
}
