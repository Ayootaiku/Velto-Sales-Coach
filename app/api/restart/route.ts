import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { secret } = await req.json();

    // Guard against unauthorized calls
    const expectedSecret = process.env.RESTART_SECRET || 'velto-restart-secret-2024';
    if (secret !== expectedSecret) {
      console.error(`[Restart API] Unauthorized. Expected: ${expectedSecret}, Got: ${secret}`);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = process.env.RAILWAY_API_TOKEN;
    if (!token) {
      console.error("[Restart API] Missing RAILWAY_API_TOKEN");
      return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
    }

    // Step 1: Get the latest active deployment ID
    const getDeploymentQuery = `
      query {
        deployments(
          first: 1,
          input: {
            serviceId: "${process.env.RAILWAY_SERVICE_ID}",
            environmentId: "${process.env.RAILWAY_ENVIRONMENT_ID}"
          }
        ) {
          edges {
            node {
              id
              status
            }
          }
        }
      }
    `;

    const deploymentRes = await fetch("https://backboard.railway.app/graphql/v2", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query: getDeploymentQuery }),
    });

    const deploymentData = await deploymentRes.json();
    const deploymentId = deploymentData.data?.deployments?.edges?.[0]?.node?.id;

    if (!deploymentId) {
      console.error("[Restart API] No active deployment found");
      return NextResponse.json({ error: "No active deployment found" }, { status: 404 });
    }

    // Step 2: Restart it (no rebuild!)
    const restartMutation = `
      mutation {
        deploymentRestart(id: "${deploymentId}")
      }
    `;

    const restartRes = await fetch("https://backboard.railway.app/graphql/v2", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query: restartMutation }),
    });

    const restartData = await restartRes.json();

    if (restartData.errors) {
      console.error("Railway GraphQL Error:", restartData.errors);
      return NextResponse.json({ error: restartData.errors }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Restart API Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
