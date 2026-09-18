import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Formcraft",
  description:
    "Design a form on a free canvas, publish it as a link, get submissions back as PDF, Excel or email.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
