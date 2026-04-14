import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "GitHub \u4ee3\u7801\u5206\u6790\u5668",
  description:
    "\u53ef\u89c6\u5316\u67e5\u770b GitHub \u4ed3\u5e93\u7ed3\u6784\u3001\u6e90\u7801\u5185\u5bb9\u4e0e AI \u5206\u6790\u7ed3\u679c",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
