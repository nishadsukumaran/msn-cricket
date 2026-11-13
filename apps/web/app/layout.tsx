import "./globals.css";
import PWA from "./pwa";
import type { Metadata, Viewport } from "next";
export const metadata: Metadata = {
  title: "MSN Cricket · Auction Room",
  description:
    "A club, a squad, a winning bid. Cricket auctions for Kerala clubs.",
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#EDF3FB",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <PWA />
        {children}
      </body>
    </html>
  );
}
