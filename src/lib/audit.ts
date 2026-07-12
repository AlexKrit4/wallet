import { prisma } from "@/lib/prisma";

export async function audit(params: {
  actorId?: string;
  action: string;
  target?: string;
  ip?: string;
  metadata?: Record<string, string | number | boolean | null>;
}) {
  await prisma.auditLog.create({
    data: {
      actorId: params.actorId,
      action: params.action,
      target: params.target,
      ip: params.ip,
      metadata: params.metadata,
    },
  });
}

export async function heartbeat(
  name: string,
  status: string,
  metadata?: Record<string, string | number | boolean | null>,
) {
  await prisma.workerHeartbeat.upsert({
    where: { name },
    create: { name, status, metadata },
    update: { status, metadata, lastSeenAt: new Date() },
  });
}
