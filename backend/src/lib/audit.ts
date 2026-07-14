import type { Prisma, UserRole } from "@prisma/client";
import prisma from "./prisma";
import type { AuthUser } from "../types";

type AuditInput = {
  actor?: AuthUser | null;
  actorUser?: {
    id: number;
    username: string;
    displayName: string;
    role: UserRole;
  } | null;
  action: string;
  entityType: string;
  entityId?: string | number | null;
  summary: string;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
};

export async function recordAudit(input: AuditInput, tx: Prisma.TransactionClient = prisma): Promise<void> {
  const actorUser = input.actorUser;
  await tx.auditLog.create({
    data: {
      actorUserId: actorUser?.id ?? input.actor?.userId ?? null,
      actorUsername: actorUser?.username ?? input.actor?.username ?? null,
      actorDisplayName: actorUser?.displayName ?? null,
      actorRole: actorUser?.role ?? input.actor?.role ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId == null ? null : String(input.entityId),
      summary: input.summary,
      before: input.before == null ? undefined : (input.before as Prisma.InputJsonValue),
      after: input.after == null ? undefined : (input.after as Prisma.InputJsonValue),
      metadata: input.metadata == null ? undefined : (input.metadata as Prisma.InputJsonValue)
    }
  });
}
