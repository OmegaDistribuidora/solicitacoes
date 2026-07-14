import type { ModuleKey, UserRole } from "@prisma/client";

export type AppUserRole = UserRole;
export type AppModuleKey = ModuleKey;

export type AuthUser = {
  userId: number;
  username: string;
  role: AppUserRole;
};
