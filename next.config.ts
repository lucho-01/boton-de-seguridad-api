import type { NextConfig } from "next";

/** Cabeceras defensivas para una API JSON sin cookies (informe de seguridad A0). */
const cabecerasSeguridad = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [{ source: "/:ruta*", headers: cabecerasSeguridad }];
  },
};

export default nextConfig;
