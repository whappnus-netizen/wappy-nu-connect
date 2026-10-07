// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import netlify from "@netlify/vite-plugin-tanstack-start";

// On Netlify builds, swap nitro for Netlify's official TanStack Start adapter, which
// emits the client to dist/client and the SSR server as a Netlify Function.
// Lovable builds (NETLIFY unset) keep the default nitro/Cloudflare pipeline.
const isNetlifyBuild = process.env["NETLIFY"] === "true";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(process.env["VITE_SUPABASE_URL"]),
      "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(process.env["VITE_SUPABASE_ANON_KEY"]),
    },
  },
  ...(isNetlifyBuild && { nitro: false, plugins: [netlify()] }),
});
