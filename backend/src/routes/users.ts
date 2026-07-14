import type { FastifyInstance } from "fastify";
import { z } from "zod";
import prisma from "../lib/prisma";
import { recordAudit } from "../lib/audit";
import { requireAdmin, requireAuth, signToken } from "../lib/security";
import { normalizeCodes, normalizeUsername, serializeUser } from "../lib/users";

const userSchema = z.object({
  username: z.string().min(2),
  displayName: z.string().min(2),
  role: z.enum(["ADMIN", "ANALYST", "SUPERVISOR"]),
  active: z.boolean().default(true),
  routeirizacao: z
    .object({
      enabled: z.boolean().default(false),
      supervisorCodes: z.array(z.coerce.number().int().positive()).default([])
    })
    .default({ enabled: false, supervisorCodes: [] })
});

async function countActiveAdmins(): Promise<number> {
  return prisma.user.count({ where: { role: "ADMIN", active: true } });
}

function validateAccess(data: z.infer<typeof userSchema>): string | null {
  if (data.role === "SUPERVISOR" && data.routeirizacao.enabled && !data.routeirizacao.supervisorCodes.length) {
    return "Informe ao menos um codigo de supervisor para roteirizacao.";
  }
  return null;
}

export async function registerUserRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/users", { preHandler: [requireAuth, requireAdmin] }, async () => {
    const users = await prisma.user.findMany({
      include: { moduleAccesses: true },
      orderBy: [{ role: "asc" }, { username: "asc" }]
    });
    return { users: users.map(serializeUser) };
  });

  app.post("/api/users", { preHandler: [requireAuth, requireAdmin] }, async (request, reply) => {
    const parsed = userSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "Dados do usuario invalidos." });

    const validationError = validateAccess(parsed.data);
    if (validationError) return reply.code(400).send({ message: validationError });

    const username = normalizeUsername(parsed.data.username);
    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) return reply.code(409).send({ message: "Ja existe um usuario com esse login." });

    const routeCodes = normalizeCodes(parsed.data.routeirizacao.supervisorCodes);
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          username,
          displayName: parsed.data.displayName.trim(),
          role: parsed.data.role,
          active: parsed.data.active,
          moduleAccesses:
            parsed.data.role === "SUPERVISOR" && parsed.data.routeirizacao.enabled
              ? { create: [{ module: "ROUTEIRIZACAO", supervisorCodes: routeCodes }] }
              : undefined
        },
        include: { moduleAccesses: true }
      });

      await recordAudit(
        {
          actor: request.authUser,
          action: "CREATE_USER",
          entityType: "USER",
          entityId: created.id,
          summary: `${created.displayName} foi criado.`,
          after: serializeUser(created)
        },
        tx
      );

      return created;
    });

    return reply.code(201).send({ user: serializeUser(user) });
  });

  app.put("/api/users/:id", { preHandler: [requireAuth, requireAdmin] }, async (request, reply) => {
    const userId = Number((request.params as { id: string }).id);
    if (!Number.isInteger(userId) || userId <= 0) return reply.code(400).send({ message: "Usuario invalido." });

    const parsed = userSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "Dados do usuario invalidos." });

    const validationError = validateAccess(parsed.data);
    if (validationError) return reply.code(400).send({ message: validationError });

    const current = await prisma.user.findUnique({ where: { id: userId }, include: { moduleAccesses: true } });
    if (!current) return reply.code(404).send({ message: "Usuario nao encontrado." });

    const username = normalizeUsername(parsed.data.username);
    const owner = await prisma.user.findUnique({ where: { username } });
    if (owner && owner.id !== userId) return reply.code(409).send({ message: "Ja existe um usuario com esse login." });

    const activeAdmins = await countActiveAdmins();
    if (
      current.role === "ADMIN" &&
      current.active &&
      activeAdmins <= 1 &&
      (parsed.data.role !== "ADMIN" || parsed.data.active === false)
    ) {
      return reply.code(400).send({ message: "Nao e possivel remover o ultimo administrador ativo." });
    }

    const beforeSnapshot = serializeUser(current);
    const routeCodes = normalizeCodes(parsed.data.routeirizacao.supervisorCodes);

    const updated = await prisma.$transaction(async (tx) => {
      await tx.userModuleAccess.deleteMany({ where: { userId } });

      const user = await tx.user.update({
        where: { id: userId },
        data: {
          username,
          displayName: parsed.data.displayName.trim(),
          role: parsed.data.role,
          active: parsed.data.active,
          moduleAccesses:
            parsed.data.role === "SUPERVISOR" && parsed.data.routeirizacao.enabled
              ? { create: [{ module: "ROUTEIRIZACAO", supervisorCodes: routeCodes }] }
              : undefined
        },
        include: { moduleAccesses: true }
      });

      await recordAudit(
        {
          actor: request.authUser,
          action: "UPDATE_USER",
          entityType: "USER",
          entityId: userId,
          summary: `${user.displayName} foi atualizado.`,
          before: beforeSnapshot,
          after: serializeUser(user)
        },
        tx
      );

      return user;
    });

    return {
      user: serializeUser(updated),
      ...(request.authUser?.userId === updated.id
        ? { sessionToken: signToken({ userId: updated.id, username: updated.username, role: updated.role }) }
        : {})
    };
  });

  app.delete("/api/users/:id", { preHandler: [requireAuth, requireAdmin] }, async (request, reply) => {
    const userId = Number((request.params as { id: string }).id);
    if (!Number.isInteger(userId) || userId <= 0) return reply.code(400).send({ message: "Usuario invalido." });

    const current = await prisma.user.findUnique({ where: { id: userId }, include: { moduleAccesses: true } });
    if (!current) return reply.code(404).send({ message: "Usuario nao encontrado." });
    if (request.authUser?.userId === current.id) return reply.code(400).send({ message: "Nao e permitido remover o proprio usuario." });

    const activeAdmins = await countActiveAdmins();
    if (current.role === "ADMIN" && current.active && activeAdmins <= 1) {
      return reply.code(400).send({ message: "Nao e possivel remover o ultimo administrador ativo." });
    }

    const beforeSnapshot = serializeUser(current);
    await prisma.$transaction(async (tx) => {
      await tx.user.delete({ where: { id: userId } });
      await recordAudit(
        {
          actor: request.authUser,
          action: "DELETE_USER",
          entityType: "USER",
          entityId: userId,
          summary: `${current.displayName} foi excluido.`,
          before: beforeSnapshot
        },
        tx
      );
    });

    return reply.code(204).send();
  });
}
