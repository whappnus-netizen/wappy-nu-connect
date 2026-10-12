import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import netlify from "@netlify/vite-plugin-tanstack-start";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import viteReact from "@vitejs/plugin-react";

// Use the official TanStack Start + Netlify plugin pipeline.
// The Lovable wrapper conditionally replaced the plugin list on Netlify builds,
// which can leave TanStack's route-tree crawler without a consistent plugin lifecycle.
export default defineConfig({
  plugins: [
    tanstackStart({
      server: { entry: "server" },
    }),
    tailwindcss(),
    tsconfigPaths(),
    viteReact(),
    netlify(),
  ],
});
