import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MSN Cricket Auction",
    short_name: "MSN Cricket",
    description: "Club cricket auctions in English and Malayalam",
    start_url: "/",
    display: "standalone",
    background_color: "#EDF3FB",
    theme_color: "#0759D3",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
