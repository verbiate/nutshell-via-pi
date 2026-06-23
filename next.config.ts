import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },
  // ponytail: stub out phonemizer so kokoro-js's internal import doesn't
  // load the real package (Emscripten code crashes in the browser). We
  // phonemize server-side via /api/tts/phonemize instead.
  turbopack: {
    resolveAlias: {
      phonemizer: "./src/lib/tts/phonemizer-stub.ts",
    },
  },
};

export default nextConfig;
