const { existsSync } = require("node:fs");
const { execFileSync } = require("node:child_process");

if (!existsSync("dist/server.js")) {
  console.log("dist/server.js nao encontrado; executando build do backend...");
  execFileSync("npm", ["run", "build"], { stdio: "inherit", shell: process.platform === "win32" });
}
