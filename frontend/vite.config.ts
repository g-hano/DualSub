import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API_TARGET = process.env.VITE_API_PROXY_TARGET ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    allowedHosts: [".ngrok-free.app", ".ngrok.io"],
    proxy: {
      "/api": {
        target: API_TARGET,
        changeOrigin: true,
        ws: true,
        timeout: 600_000,
        proxyTimeout: 600_000,
      },
    },
  },
});
