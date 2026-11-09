import { defineConfig as defineLovableConfig } from "@lovable.dev/vite-tanstack-config";
import type { ConfigEnv } from "vite";

export default async function config(env: ConfigEnv) {
  const isLovableBuild =
    process.env["LOVABLE_SANDBOX"] === "1" ||
    Boolean(process.env["DEV_SERVER__PROJECT_PATH"]);
  const isNetlifyBuild = process.env["NETLIFY"] === "true" && !isLovableBuild;

  if (isNetlifyBuild) {
    const [vite, start, netlify, tailwindcss, tsconfigPaths, viteReact] = await Promise.all([
      import("vite"),
      import("@tanstack/react-start/plugin/vite"),
      import("@netlify/vite-plugin-tanstack-start"),
      import("@tailwindcss/vite"),
      import("vite-tsconfig-paths"),
      import("@vitejs/plugin-react"),
    ]);

    return vite.defineConfig({
      plugins: [
        tailwindcss.default(),
        start.tanstackStart({ server: { entry: "server" } }),
        netlify.default(),
        tsconfigPaths.default(),
        viteReact.default(),
      ],
    });
  }

  return defineLovableConfig({
    tanstackStart: { server: { entry: "server" } },
  })(env);
}
