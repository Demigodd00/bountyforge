import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  agentRules: false,
  poweredByHeader: false,
  async headers() {
    const noStore = ["/", "/bounties", "/bounties/:id", "/post", "/dashboard", "/admin"].map((source) => ({
      source,
      headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
    }));
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'" },
      ],
    }, ...noStore];
  },
};

export default nextConfig;
