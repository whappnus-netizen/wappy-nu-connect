// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import netlify from "@netlify/vite-plugin-tanstack-start";

// On Netlify builds, swap nitro for Netlify's official TanStack Start adapter, which
// emits the client to dist/client and the SSR server as a Netlify Function.
// Lovable builds (NETLIFY unset) keep the default nitro/Cloudflare pipeline.
const isNetlifyBuild = process.env["NETLIFY"] === "true";

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  ...(isNetlifyBuild && { nitro: false, plugins: [netlify()] }),
});
