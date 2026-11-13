"use client";
import { useEffect } from "react";
export default function PWA() {
  useEffect(() => {
    if ("serviceWorker" in navigator)
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* Online app remains usable if installation is unavailable. */
      });
  }, []);
  return null;
}
