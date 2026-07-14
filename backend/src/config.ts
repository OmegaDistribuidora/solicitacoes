import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

process.env.TZ = "America/Fortaleza";

function parseNormalizedList(value: string | undefined): string[] {
  return String(value || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

const envCandidates = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "..", ".env"),
  path.resolve(process.cwd(), "backend", ".env")
];

for (const envPath of envCandidates) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false });
  }
}

export const env = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: String(process.env.NODE_ENV || "development").trim(),
  jwtSecret: String(process.env.JWT_SECRET || "change-me").trim(),
  databaseUrl: String(process.env.DATABASE_URL || "").trim(),
  adminUsername: String(process.env.ADMIN_USERNAME || "admin").trim().toLowerCase(),
  adminDisplayName: String(process.env.ADMIN_DISPLAY_NAME || "Administrador").trim(),
  frontendUrl: String(process.env.FRONTEND_URL || "http://localhost:5173").trim(),
  allowLocalLogin:
    String(process.env.NODE_ENV || "development").trim() !== "production" &&
    String(process.env.LOCAL_LOGIN_ENABLED || "true").trim().toLowerCase() !== "false",
  timeZone: "America/Fortaleza",
  ecosystemSso: {
    issuer: String(process.env.ECOSYSTEM_SSO_ISSUER || "ecosistema-omega").trim(),
    audience: String(process.env.ECOSYSTEM_SSO_AUDIENCE || "solicitacoes-trade").trim(),
    sharedSecret: String(process.env.ECOSYSTEM_SSO_SHARED_SECRET || "").trim(),
    adminUsers: parseNormalizedList(process.env.ECOSYSTEM_SSO_ADMIN_USERS)
  },
  sourceRca: {
    databaseUrl: String(process.env.SOURCE_DATABASE_URL || "").trim(),
    schema: String(process.env.SOURCE_RCA_SCHEMA || "filial").trim(),
    table: String(process.env.SOURCE_RCA_TABLE || "deqpcomercial").trim()
  }
};
