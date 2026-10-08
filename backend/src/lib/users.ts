import type { User, UserModuleAccess } from "@prisma/client";

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeCodes(values: Array<number | string | null | undefined>): number[] {
  const parsed = values
    .flatMap((value) => String(value ?? "").split(/[\s,;]+/))
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);

  return Array.from(new Set(parsed));
}

export function serializeUser(user: User & { moduleAccesses?: UserModuleAccess[] }) {
  const routeAccess = user.moduleAccesses?.find((item) => item.module === "ROUTEIRIZACAO");
  const promoterRouteAccess = user.moduleAccesses?.find((item) => item.module === "ROTA_PROMOTOR");
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    active: user.active,
    modules:
      user.role === "ADMIN" || user.role === "ANALYST"
        ? [
            { module: "ROUTEIRIZACAO", supervisorCodes: [] },
            { module: "ROTA_PROMOTOR", supervisorCodes: [] }
          ]
        : user.moduleAccesses?.map((item) => ({
            module: item.module,
            supervisorCodes: item.supervisorCodes
          })) || [],
    routeSupervisorCodes: routeAccess?.supervisorCodes || [],
    promoterRouteEnabled: user.role === "ADMIN" || user.role === "ANALYST" || Boolean(promoterRouteAccess),
    createdAt: user.createdAt
  };
}
