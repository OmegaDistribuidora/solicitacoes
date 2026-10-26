import type { User, UserModuleAccess } from "@prisma/client";

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function serializeUser(user: User & { moduleAccesses?: UserModuleAccess[] }) {
  const promoterRouteAccess = user.moduleAccesses?.find((item) => item.module === "ROTA_PROMOTOR");
  const hasImplicitPromoterAccess = user.role === "MERCH_COORDINATOR" || user.role === "PROMOTER";
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    active: user.active,
    modules:
      user.role === "ADMIN" || user.role === "ANALYST"
        ? [{ module: "ROTA_PROMOTOR", supervisorCodes: [] }]
        : hasImplicitPromoterAccess
          ? [{ module: "ROTA_PROMOTOR", supervisorCodes: [] }]
          : user.moduleAccesses?.filter((item) => item.module === "ROTA_PROMOTOR").map((item) => ({
            module: item.module,
            supervisorCodes: item.supervisorCodes
          })) || [],
    promoterRouteEnabled: user.role === "ADMIN" || user.role === "ANALYST" || hasImplicitPromoterAccess || Boolean(promoterRouteAccess),
    createdAt: user.createdAt
  };
}
