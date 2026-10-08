import jwt from "jsonwebtoken";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { ModuleKey } from "@prisma/client";
import { env } from "../config";
import prisma from "./prisma";
import type { AppUserRole, AuthUser } from "../types";

type JwtPayload = {
  userId: number;
  username: string;
  role: AppUserRole;
};

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: "8h" });
}

export function verifyToken(token: string): AuthUser {
  return jwt.verify(token, env.jwtSecret) as AuthUser;
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const auth = request.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) {
    reply.code(401).send({ message: "Token ausente." });
    return;
  }

  try {
    request.authUser = verifyToken(token);
  } catch (error) {
    reply.code(401).send({ message: "Token invalido." });
  }
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.authUser) {
    reply.code(401).send({ message: "Usuario nao autenticado." });
    return;
  }

  if (request.authUser.role !== "ADMIN") {
    reply.code(403).send({ message: "Acesso restrito ao administrador." });
  }
}

export function canReviewRoutes(role: AppUserRole): boolean {
  return role === "ADMIN" || role === "ANALYST";
}

export async function requireRouteReviewer(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.authUser) {
    reply.code(401).send({ message: "Usuario nao autenticado." });
    return;
  }

  if (!canReviewRoutes(request.authUser.role)) {
    reply.code(403).send({ message: "Acesso restrito a administradores e analistas." });
  }
}

export const requirePromoterRouteReviewer = requireRouteReviewer;

export async function getUserModuleAccess(userId: number, module: ModuleKey) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { moduleAccesses: true }
  });

  if (!user || !user.active) {
    return null;
  }

  const access = user.moduleAccesses.find((item) => item.module === module);
  return {
    user,
    canAccess: user.role === "ADMIN" || user.role === "ANALYST" || Boolean(access),
    supervisorCodes: user.role === "ADMIN" || user.role === "ANALYST" ? [] : access?.supervisorCodes || []
  };
}

export async function requireModuleAccess(
  request: FastifyRequest,
  reply: FastifyReply,
  module: ModuleKey
): Promise<void> {
  if (!request.authUser) {
    reply.code(401).send({ message: "Usuario nao autenticado." });
    return;
  }

  const access = await getUserModuleAccess(request.authUser.userId, module);
  if (!access?.canAccess) {
    reply.code(403).send({ message: "Usuario sem acesso a este modulo." });
  }
}
