import { NextResponse } from 'next/server';

const RAILWAY_GRAPHQL = 'https://backboard.railway.com/graphql/v2';
const RESTART_COOLDOWN_MS = 0;
let lastRestartAt = 0;

export async function POST(request: Request) {
  const secret = request.headers.get('X-Restart-Secret');
  const expected = process.env.RESTART_SECRET;
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const token = process.env.RAILWAY_API_TOKEN;
  const projectId = process.env.RAILWAY_PROJECT_ID;
  const environmentId = process.env.RAILWAY_ENVIRONMENT_ID;
  const serviceId = process.env.RAILWAY_SERVICE_ID;

  if (!token) {
    return NextResponse.json(
      { triggered: false, error: 'RAILWAY_API_TOKEN not configured' },
      { status: 202 }
    );
  }

  const now = Date.now();
  if (now - lastRestartAt < RESTART_COOLDOWN_MS) {
    return NextResponse.json(
      { triggered: false, reason: 'cooldown' },
      { status: 202 }
    );
  }

  const directDeploymentId = process.env.RAILWAY_DEPLOYMENT_ID;
  let deploymentId: string | null = directDeploymentId || null;

  if (!deploymentId && projectId && environmentId && serviceId) {
    const query = `
      query deployments($first: Int!, $input: DeploymentListInput!) {
        deployments(input: $input, first: $first) {
          edges {
            node {
              id
              status
            }
          }
        }
      }
    `;
    const res = await fetch(RAILWAY_GRAPHQL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        query,
        variables: {
          first: 5,
          input: {
            projectId,
            environmentId,
            serviceId,
          },
        },
      }),
    });
    if (!res.ok) {
      return NextResponse.json(
        { triggered: false, error: `Railway query failed: ${res.status}` },
        { status: 202 }
      );
    }
    const data = await res.json();
    const edges = data?.data?.deployments?.edges ?? [];
    const active = edges.find(
      (e: { node: { status: string } }) =>
        e.node.status === 'SUCCESS' || e.node.status === 'ACTIVE'
    );
    deploymentId = active?.node?.id ?? null;
  }

  if (!deploymentId) {
    return NextResponse.json(
      {
        triggered: false,
        error:
          'No deployment ID. Set RAILWAY_DEPLOYMENT_ID or RAILWAY_PROJECT_ID + RAILWAY_ENVIRONMENT_ID + RAILWAY_SERVICE_ID',
      },
      { status: 202 }
    );
  }

  const mutation = `
    mutation deploymentRestart($id: String!) {
      deploymentRestart(id: $id)
    }
  `;
  const restartRes = await fetch(RAILWAY_GRAPHQL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      query: mutation,
      variables: { id: deploymentId },
    }),
  });

  if (!restartRes.ok) {
    return NextResponse.json(
      { triggered: false, error: `Railway restart failed: ${restartRes.status}` },
      { status: 202 }
    );
  }
  const restartData = await restartRes.json();
  if (restartData?.errors?.length) {
    return NextResponse.json(
      { triggered: false, error: restartData.errors[0]?.message ?? 'GraphQL error' },
      { status: 202 }
    );
  }

  lastRestartAt = now;
  return NextResponse.json(
    { triggered: true },
    { status: 202 }
  );
}
