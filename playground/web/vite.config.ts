import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The .wasm is imported as a URL and instantiated by hand, so Vite should
  // copy it rather than try to inline or transform it.
  assetsInclude: ["**/*.wasm"],
});
