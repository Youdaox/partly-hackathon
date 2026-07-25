import type { NextConfig } from "next";

/**
 * Where the FastAPI prediction backend actually listens. It stays on its own port; the
 * rewrites below just mean nothing outside this process has to know that.
 */
const BACKEND_URL = (process.env.BACKEND_URL ?? "http://localhost:8080").replace(/\/$/, "");

const nextConfig: NextConfig = {
  /**
   * Serve the backend through the Next port, so the browser — and the phone — only ever
   * talk to one origin. That takes CORS out of the picture and means a client needs one
   * host:port rather than two.
   *
   * A rewrite is a proxy, not a redirect: the URL the client sees never changes, and the
   * request is forwarded server-side.
   */
  async rewrites() {
    return [
      { source: "/v1/:path*", destination: `${BACKEND_URL}/v1/:path*` },
      // Handy for confirming the backend is alive without leaving the app's origin.
      { source: "/healthz", destination: `${BACKEND_URL}/healthz` },
      { source: "/openapi.json", destination: `${BACKEND_URL}/openapi.json` },
      { source: "/docs", destination: `${BACKEND_URL}/docs` },
    ];
  },
};

export default nextConfig;
