import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { kycSchema } from "@/lib/validators";
import { handleRouteError, jsonError, jsonOk } from "@/lib/api";
import { assertSameOrigin } from "@/lib/security";

export async function POST(request: Request) {
  try {
    await assertSameOrigin(request);
    const user = await requireUser();
    const body = kycSchema.parse(await request.json());

    if (user.kycStatus === "APPROVED") {
      return jsonError("KYC already approved");
    }

    const pending = await prisma.kycSubmission.findFirst({
      where: { userId: user.id, status: "PENDING" },
    });
    if (pending) {
      return jsonError("KYC already pending review");
    }

    const submission = await prisma.$transaction(async (tx) => {
      const created = await tx.kycSubmission.create({
        data: {
          userId: user.id,
          fullName: body.fullName,
          documentType: body.documentType,
          documentNumber: body.documentNumber,
          country: body.country,
          notes: body.notes,
          status: "PENDING",
        },
      });

      await tx.user.update({
        where: { id: user.id },
        data: { kycStatus: "PENDING" },
      });

      return created;
    });

    return jsonOk({ submission }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function GET() {
  try {
    const user = await requireUser();
    const latest = await prisma.kycSubmission.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });
    return jsonOk({ submission: latest, kycStatus: user.kycStatus });
  } catch (error) {
    return handleRouteError(error);
  }
}
