import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  try {
    const { secret } = await req.json();

    const expectedSecret = process.env.RESTART_SECRET || "velto-restart-secret-2024";
    if (secret !== expectedSecret) {
      console.error(`[Restart API] Unauthorized. Expected: ${expectedSecret}, Got: ${secret}`);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
    }

    const apiKey = process.env.RENDER_API_KEY;
    const serviceId = process.env.RENDER_SERVICE_ID;
    if (!apiKey || !serviceId) {
      console.error("[Restart API] Missing RENDER_API_KEY or RENDER_SERVICE_ID");
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500, headers }
      );
    }

    const res = await fetch(
      `https://api.render.com/v1/services/${serviceId}/restart`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      }
    );

    if (!res.ok) {
      const text = await res.text();
      console.error("[Restart API] Render error:", res.status, text);
      return NextResponse.json(
        { error: "Render restart failed", detail: text },
        { status: res.status >= 500 ? 502 : res.status, headers }
      );
    }

    return NextResponse.json({ success: true }, { headers });
  } catch (error) {
    console.error("Restart API Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500, headers });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
