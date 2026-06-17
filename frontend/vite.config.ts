import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // En desarrollo, reenvía las llamadas a la API al backend local.
    proxy: {
      "/api": "http://localhost:3000",
      "/t": "http://localhost:3000",
      "/webhook": "http://localhost:3000",
      "/health": "http://localhost:3000",
    },
  },
});
