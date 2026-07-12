import { prisma } from "@/lib/prisma";
import { createSessionToken, hashPassword, setSessionCookie } from "@/lib/auth";
import { registerSchema } from "@/lib/validators";
import { handleRouteError, jsonOk } from "@/lib/api";
import { audit } from "@/lib/audit";
import { assertSameOrigin, getRequestIp, rateLimit } from "@/lib/security";

export async function POST(request: Request) {
  try {
    await assertSameOrigin(request);
    const ip = await getRequestIp();
    await rateLimit("register", ip, 5, 60 * 60);
    const body = registerSchema.parse(await request.json());
    const email = body.email.toLowerCase().trim();

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return Response.json({ error: "Email already registered" }, { status: 409 });
    }

    const passwordHash = await hashPassword(body.password);
    const user = await prisma.user.create({
      data: { email, passwordHash },
      select: {
        id: true,
        email: true,
        role: true,
        kycStatus: true,
        isFrozen: true,
      },
    });

    const token = await createSessionToken(user);
    await setSessionCookie(token);
    await audit({
      actorId: user.id,
      action: "AUTH_REGISTERED",
      target: user.id,
      ip,
    });

    return jsonOk({ user }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
