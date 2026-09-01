import { env } from "@/config/env";

type RouteContext = { params: Promise<{ path: string[] }> };

async function proxy(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { path } = await context.params;
  const target = new URL(`/api/v1/${path.join("/")}`, env.BACKEND_API_URL);
  target.search = new URL(request.url).search;

  const headers = new Headers();
  for (const name of ["authorization", "content-type", "if-match"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  try {
    const response = await fetch(target, {
      method: request.method,
      headers,
      ...(request.method === "GET" || request.method === "HEAD"
        ? {}
        : { body: await request.arrayBuffer() }),
      cache: "no-store",
      signal: request.signal,
    });
    return new Response(response.body, {
      status: response.status,
      headers: {
        "content-type":
          response.headers.get("content-type") ?? "application/json",
      },
    });
  } catch {
    return Response.json(
      {
        message:
          "The Pulse AI service is unavailable. Your entries remain in this browser; try again when the connection is restored.",
      },
      { status: 503 },
    );
  }
}

export const GET = proxy;
export const PATCH = proxy;
export const POST = proxy;
