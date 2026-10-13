import type { MetadataRoute } from "next";

// Makes Hobzerve installable as an app on desktop (Chrome, Edge, Safari "Add to Dock"), Android and iPhone
// ("Add to Home Screen"). Served at /manifest.webmanifest and linked from every page by Next.js.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Hobzerve",
    short_name: "Hobzerve",
    description: "Employee-owned work tracking",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f6f8fe",
    theme_color: "#f6f8fe",
    categories: ["productivity", "business"],
    icons: [
      { src: "/pwa/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Time", short_name: "Time", url: "/time", icons: [{ src: "/pwa/icon-192.png", sizes: "192x192" }] },
      { name: "Tasks", short_name: "Tasks", url: "/tasks", icons: [{ src: "/pwa/icon-192.png", sizes: "192x192" }] },
      { name: "Calendar", short_name: "Calendar", url: "/calendar", icons: [{ src: "/pwa/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
