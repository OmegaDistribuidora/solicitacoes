import type { FastifyInstance, FastifyReply } from "fastify";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { env } from "../config";
import prisma from "../lib/prisma";
import { recordAudit } from "../lib/audit";
import { requireAuth, signToken } from "../lib/security";
import { normalizeUsername, serializeUser } from "../lib/users";
import type { AppUserRole } from "../types";

const loginSchema = z.object({
  username: z.string().min(1)
});

const ssoExchangeSchema = z.object({
  token: z.string().min(1)
});

const consumedSsoTokens = new Map<string, number>();

function cleanupConsumedSsoTokens(): void {
  const now = Date.now();
  for (const [jti, expiresAt] of consumedSsoTokens.entries()) {
    if (expiresAt <= now) consumedSsoTokens.delete(jti);
  }
}

function markConsumedSsoToken(jti: unknown, exp: unknown): void {
  if (typeof jti !== "string" || typeof exp !== "number") return;
  cleanupConsumedSsoTokens();
  consumedSsoTokens.set(jti, exp * 1000);
}

async function blockAdminSsoLogin(
  reply: FastifyReply,
  user: { id: number; username: string; displayName: string; role: AppUserRole },
  details: { ecosystemUsername: string | null; targetLogin: string; reason: string; ecosystemIsAdmin: boolean }
) {
  await recordAudit({
    actorUser: user,
    action: "SSO_ADMIN_LOGIN_BLOCKED",
    entityType: "AUTH",
    entityId: user.id,
    summary: `${user.displayName} teve login administrativo via SSO bloqueado.`,
    after: { authenticated: false, source: "ecosistema-omega", ...details }
  });

  return reply.code(403).send({ message: "Usuario do Ecossistema nao autorizado a acessar administrador via SSO." });
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/public/app-config", async () => ({
    systemName: "Solicitacoes Trade",
    allowLocalLogin: env.allowLocalLogin,
    ssoEnabled: Boolean(env.ecosystemSso.sharedSecret)
  }));

  app.post("/api/auth/login", async (request, reply) => {
    if (!env.allowLocalLogin) {
      return reply.code(403).send({ message: "Login local indisponivel neste ambiente. Use o Ecossistema Omega." });
    }

    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: "Login obrigatorio." });
    }

    const username = normalizeUsername(parsed.data.username);
    const user = await prisma.user.findUnique({ where: { username }, include: { moduleAccesses: true } });
    if (!user || !user.active) {
      return reply.code(401).send({ message: "Usuario nao encontrado ou inativo." });
    }

    await recordAudit({
      actorUser: user,
      action: "LOGIN",
      entityType: "AUTH",
      entityId: user.id,
      summary: `${user.displayName} realizou login local.`,
      after: { authenticated: true, source: "local" }
    });

    return {
      token: signToken({ userId: user.id, username: user.username, role: user.role }),
      user: serializeUser(user)
    };
  });

  app.post("/api/auth/sso/exchange", async (request, reply) => {
    if (!env.ecosystemSso.sharedSecret) {
      return reply.code(404).send({ message: "Login delegado indisponivel." });
    }

    const parsed = ssoExchangeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: "Token SSO obrigatorio." });
    }

    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(parsed.data.token, env.ecosystemSso.sharedSecret, {
        algorithms: ["HS256"],
        issuer: env.ecosystemSso.issuer,
        audience: env.ecosystemSso.audience
      }) as jwt.JwtPayload;
    } catch (error) {
      return reply.code(401).send({ message: "Token SSO invalido ou expirado." });
    }

    if (typeof payload.jti === "string" && consumedSsoTokens.has(payload.jti)) {
      return reply.code(401).send({ message: "Token SSO ja utilizado." });
    }

    const targetLogin = normalizeUsername(String(payload.targetLogin || ""));
    if (!targetLogin) {
      return reply.code(400).send({ message: "Token SSO sem login de destino." });
    }

    const user = await prisma.user.findUnique({ where: { username: targetLogin }, include: { moduleAccesses: true } });
    if (!user || !user.active) {
      return reply.code(401).send({ message: "Usuario alvo nao encontrado ou inativo." });
    }

    const ecosystemUsername = normalizeUsername(String(payload.ecosystemUsername || ""));
    const ecosystemIsAdmin = payload.ecosystemIsAdmin === true;
    const sameLoginAdminAccess = Boolean(ecosystemUsername) && ecosystemUsername === targetLogin;
    const allowlistedAdminAccess = Boolean(ecosystemUsername) && env.ecosystemSso.adminUsers.includes(ecosystemUsername);

    if (user.role === "ADMIN" && !ecosystemIsAdmin) {
      return blockAdminSsoLogin(reply, user, {
        ecosystemUsername: ecosystemUsername || null,
        targetLogin,
        reason: "missing-admin-claim",
        ecosystemIsAdmin
      });
    }

    if (user.role === "ADMIN" && !sameLoginAdminAccess && !allowlistedAdminAccess) {
      return blockAdminSsoLogin(reply, user, {
        ecosystemUsername: ecosystemUsername || null,
        targetLogin,
        reason: "ecosystem-admin-user-not-allowlisted",
        ecosystemIsAdmin
      });
    }

    markConsumedSsoToken(payload.jti, payload.exp);

    await recordAudit({
      actorUser: user,
      action: "SSO_LOGIN",
      entityType: "AUTH",
      entityId: user.id,
      summary: `${user.displayName} realizou login via Ecossistema Omega.`,
      after: { authenticated: true, source: "ecosistema-omega", ecosystemUsername, targetLogin }
    });

    return {
      token: signToken({ userId: user.id, username: user.username, role: user.role }),
      user: serializeUser(user)
    };
  });

  app.get("/api/auth/me", { preHandler: [requireAuth] }, async (request, reply) => {
    const authUser = request.authUser;
    if (!authUser) return reply.code(401).send({ message: "Usuario nao autenticado." });

    const user = await prisma.user.findUnique({
      where: { id: authUser.userId },
      include: { moduleAccesses: true }
    });

    if (!user || !user.active) {
      return reply.code(404).send({ message: "Usuario nao encontrado." });
    }

    return { user: serializeUser(user) };
  });
}
