import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function hostAllowed(hostname: string) {
  const configured = process.env.VWORLD_DOMAIN?.trim();
  if (!configured) return true;
  const hosts = configured.split(",").map((item) => item.trim()).filter(Boolean);
  if (hosts.includes(hostname)) return true;
  if (hosts.includes("localhost") && (hostname === "localhost" || hostname === "127.0.0.1")) {
    return true;
  }
  return false;
}

export async function GET(request: Request) {
  const apiKey = process.env.VWORLD_API_KEY?.trim();
  const hostname = new URL(request.url).hostname;

  if (!apiKey || !hostAllowed(hostname)) {
    return NextResponse.json(
      { enabled: false },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }

  return NextResponse.json(
    { enabled: true, apiKey },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
