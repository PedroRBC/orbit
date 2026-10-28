import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/", name: "Orbit — seu conteúdo, com contexto", short_name: "Orbit", lang: "pt-BR",
    description: "Seu curador pessoal de conteúdo. Transparente e no seu ritmo.",
    start_url: "/", scope: "/", display: "standalone", orientation: "any",
    background_color: "#101521", theme_color: "#101521",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
