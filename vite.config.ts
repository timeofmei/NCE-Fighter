import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [reactRouter()],
  optimizeDeps: {
    include: [
      "react",
      "react-dom/client",
      "react-router",
      "@mantine/core",
      "@mantine/hooks",
      "@vercel/analytics/react",
      "pdfjs-dist",
    ],
  },
  server: {
    watch: {
      ignored: ["**/.local-models/**", "**/build/**", "**/public/resources/**"],
    },
  },
});
