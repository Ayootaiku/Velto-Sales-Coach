import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { secret } = await req.json();

    // Guard against unauthorized calls
    if (secret !== process.env.RESTART_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const query = `
      mutation {
        serviceRestart(
          serviceId: "${process.env.RAILWAY_SERVICE_ID}"
          environmentId: "${process.env.RAILWAY_ENVIRONMENT_ID}"
        )
      }
    `;

    const response = await fetch("https://backboard.railway.app/graphql/v2", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.RAILWAY_API_TOKEN}`,
      },
      body: JSON.stringify({ query }),
    });

    const data = await response.json();

    if (data.errors) {
      console.error("Railway GraphQL Error:", data.errors);
      return NextResponse.json({ error: data.errors }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Restart API Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
