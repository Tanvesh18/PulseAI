import { cookies } from "next/headers";
export async function GET() {
  return Response.json({ enabled: process.env.NODE_ENV !== "production" });
}
export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production")
    return Response.json(
      { message: "Demo sign-in is disabled in production." },
      { status: 403 },
    );
  const body = (await request.json()) as { role?: string };
  if (!["MANAGER", "FINANCE", "HR", "DIRECTOR"].includes(body.role ?? ""))
    return Response.json({ message: "Select a role." }, { status: 400 });
  (await cookies()).set("pulse_demo_role", body.role!, {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    maxAge: 3600 * 8,
  });
  return Response.json({ ok: true });
}
export async function DELETE() {
  (await cookies()).delete("pulse_demo_role");
  return Response.json({ ok: true });
}
