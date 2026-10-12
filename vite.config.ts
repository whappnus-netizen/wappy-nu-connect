import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import netlify from "@netlify/vite-plugin-tanstack-start";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import viteReact from "@vitejs/plugin-react";

// Keep the TanStack Start plugin pipeline explicit and in the order used by
// the official Netlify integration. The custom SSR error wrapper remains at
// src/server.ts and is selected by the "server" entry.
export default defineConfig({
  plugins: [
    tailwindcss(),
    tanstackStart({
      server: { entry: "server" },
    }),
    netlify(),
    tsconfigPaths(),
    viteReact(),
  ],
});
