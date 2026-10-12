import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { validatePublicConfig } from "./src/config/publicConfig.js";

export default defineConfig(({ mode }) => {
  const values = loadEnv(mode, process.cwd(), [
    "VITE_SUPABASE_URL",
    "VITE_SUPABASE_PUBLISHABLE_KEY",
  ]);
  const validation = validatePublicConfig(
    process.env.VITE_SUPABASE_URL || values.VITE_SUPABASE_URL,
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
      values.VITE_SUPABASE_PUBLISHABLE_KEY,
  );
  // Fail before transforming or emitting a bundle that could contain a misplaced server key.
  if (validation.error) throw new Error(validation.error);
  return {
    plugins: [react()],
    base: "/calcito/",
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("node_modules/@supabase")) return "supabase";
            if (
              /node_modules\/(react|react-dom|react-router|react-router-dom|scheduler)\//.test(
                id,
              )
            )
              return "react-vendor";
          },
        },
      },
    },
  };
});
