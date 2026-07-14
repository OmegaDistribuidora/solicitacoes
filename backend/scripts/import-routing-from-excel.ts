import "../src/config";
import prisma from "../src/lib/prisma";
import { nowFortaleza } from "../src/lib/dates";
import { readRoutingWorkbook } from "../src/lib/routingExcel";

async function main() {
  const filePath = process.argv[2] || "C:\\Users\\POWERBI\\Desktop\\Rota completa.xlsx";
  const rows = readRoutingWorkbook(filePath);

  let changed = 0;
  for (const row of rows) {
    const rcaBase = await prisma.baseRca.findUnique({ where: { codusur: row.codusur } });
    const current = await prisma.routingEntry.findUnique({
      where: { codusur_codcli: { codusur: row.codusur, codcli: row.codcli } }
    });

    const data = {
      codgerente: row.codgerente ?? rcaBase?.codgerente ?? null,
      coordenador: row.coordenador ?? rcaBase?.coordenador ?? null,
      codsup: row.codsup ?? rcaBase?.codsup ?? 0,
      supervisor: row.supervisor ?? rcaBase?.supervisor ?? "Nao localizado",
      codusur: row.codusur,
      rca: rcaBase?.rca || row.rca || `RCA ${row.codusur}`,
      codcli: row.codcli,
      cliente: row.cliente || `Cliente ${row.codcli}`,
      dia: row.dia,
      tipo: row.tipo
    };

    const hasChange =
      !current ||
      current.codgerente !== data.codgerente ||
      current.coordenador !== data.coordenador ||
      current.codsup !== data.codsup ||
      current.supervisor !== data.supervisor ||
      current.rca !== data.rca ||
      current.cliente !== data.cliente ||
      current.dia !== data.dia ||
      current.tipo !== data.tipo;

    if (!hasChange) continue;

    await prisma.routingEntry.upsert({
      where: { codusur_codcli: { codusur: row.codusur, codcli: row.codcli } },
      create: { ...data, dataAlteracao: nowFortaleza() },
      update: { ...data, dataAlteracao: nowFortaleza() }
    });
    changed += 1;
  }

  console.log(`Linhas lidas: ${rows.length}`);
  console.log(`Linhas inseridas/alteradas: ${changed}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
