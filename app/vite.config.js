import { defineConfig } from "vite";
import { handleChat } from "./api/chat.js";
import { handleChatgpt } from "./api/chatgpt.js";

// /api/chat in dev runs the same handler the deployed Pages Function runs, with the key from the shell
const devApi = {
  name: "dev-api",
  configureServer(server) {
    server.middlewares.use("/api/chat", async (req, res) => {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const request = new Request("http://localhost/api/chat", { method: "POST", body: Buffer.concat(chunks) });
      const out = await handleChat(request, process.env);
      res.statusCode = out.status;
      res.setHeader("content-type", "application/json");
      res.end(await out.text());
    });
    // Sign in with ChatGPT works only here, on your own machine (see api/chatgpt.js)
    server.middlewares.use("/api/chatgpt", handleChatgpt);
  },
};

// MapLibre 6 loads its worker from a sibling file (main.js passes it via setWorkerUrl), so keep it out of
// prebundling; fs.allow lets the app import the shared tool schema and golden set from ../eval
export default defineConfig({
  plugins: [devApi],
  optimizeDeps: { exclude: ["maplibre-gl"] },
  build: { target: "esnext" },
  server: { fs: { allow: [".."] } },
});
