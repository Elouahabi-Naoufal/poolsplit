import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  icons: { icon: "/favicon.png?v2", apple: "/logo.png" },
};

/* fav */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return children;
}