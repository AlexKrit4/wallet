import { clearSessionCookie } from "@/lib/auth";
import { jsonOk } from "@/lib/api";
import { assertSameOrigin } from "@/lib/security";

export async function POST(request: Request) {
  await assertSameOrigin(request);
  await clearSessionCookie();
  return jsonOk({ ok: true });
}
