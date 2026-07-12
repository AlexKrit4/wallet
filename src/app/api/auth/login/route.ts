import { prisma } from "@/lib/prisma";
import {
  createSessionToken,
  setSessionCookie,
  verifyPassword,
} from "@/lib/auth";
import { loginSchema } from "@/lib/validators";
import { handleRouteError, jsonError, jsonOk } from "@/lib/api";
import { audit } from "@/lib/audit";
import { assertSameOrigin, getRequestIp, rateLimit } from "@/lib/security";

export async function POST(request: Request) {
  try {
    await assertSameOrigin(request);
    const ip = await getRequestIp();
    await rateLimit("login", ip, 10, 15 * 60);
    const body = loginSchema.parse(await request.json());
    const email = body.email.toLowerCase().trim();

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
      await audit({ action: "AUTH_LOGIN_FAILED", target: email, ip });
      return jsonError("Invalid email or password", 401);
    }

    const sessionUser = {
      id: user.id,
      email: user.email,
      role: user.role,
      kycStatus: user.kycStatus,
      isFrozen: user.isFrozen,
    };

    const token = await createSessionToken(sessionUser);
    await setSessionCookie(token);
    await audit({
      actorId: user.id,
      action: "AUTH_LOGIN_SUCCEEDED",
      target: user.id,
      ip,
    });

    return jsonOk({ user: sessionUser });
  } catch (error) {
    return handleRouteError(error);
  }
}
