import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { provisionWalletForUser } from "@/lib/wallet";
import { handleRouteError, jsonError, jsonOk } from "@/lib/api";
import { audit } from "@/lib/audit";
import { assertSameOrigin, getRequestIp } from "@/lib/security";

export async function GET() {
  try {
    await requireAdmin();
    const items = await prisma.kycSubmission.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { id: true, email: true, kycStatus: true } },
      },
    });
    return jsonOk({ items });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    await assertSameOrigin(request);
    const admin = await requireAdmin();
    const ip = await getRequestIp();
    const body = (await request.json()) as {
      id?: string;
      action?: "approve" | "reject";
      adminNote?: string;
    };

    if (!body.id || !body.action) {
      return jsonError("id and action are required");
    }

    const submission = await prisma.kycSubmission.findUnique({
      where: { id: body.id },
    });
    if (!submission || submission.status !== "PENDING") {
      return jsonError("Submission not found or already reviewed", 404);
    }

    if (body.action === "approve") {
      await provisionWalletForUser(submission.userId);
      await prisma.$transaction(async (tx) => {
        await tx.kycSubmission.update({
          where: { id: submission.id },
          data: {
            status: "APPROVED",
            adminNote: body.adminNote,
            reviewedAt: new Date(),
            reviewedById: admin.id,
          },
        });
        await tx.user.update({
          where: { id: submission.userId },
          data: { kycStatus: "APPROVED" },
        });
      });

      await audit({
        actorId: admin.id,
        action: "KYC_APPROVED",
        target: submission.userId,
        ip,
        metadata: { submissionId: submission.id },
      });
      return jsonOk({ ok: true, status: "APPROVED" });
    }

    await prisma.$transaction(async (tx) => {
      await tx.kycSubmission.update({
        where: { id: submission.id },
        data: {
          status: "REJECTED",
          adminNote: body.adminNote,
          reviewedAt: new Date(),
          reviewedById: admin.id,
        },
      });
      await tx.user.update({
        where: { id: submission.userId },
        data: { kycStatus: "REJECTED" },
      });
    });

    await audit({
      actorId: admin.id,
      action: "KYC_REJECTED",
      target: submission.userId,
      ip,
      metadata: {
        submissionId: submission.id,
        note: body.adminNote ?? null,
      },
    });
    return jsonOk({ ok: true, status: "REJECTED" });
  } catch (error) {
    return handleRouteError(error);
  }
}
