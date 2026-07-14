import "../src/config";
import { Client } from "pg";
import prisma from "../src/lib/prisma";
import { env } from "../src/config";

type SourceRcaRow = {
  codgerente: number | null;
  coordenador: string | null;
  codsup: number;
  supervisor: string;
  codusur: number;
  rca: string;
};

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

async function findColumn(source: Client, candidates: string[]): Promise<string> {
  const result = await source.query<{ column_name: string }>(
    `
      select column_name
      from information_schema.columns
      where table_schema = $1
        and table_name = $2
    `,
    [env.sourceRca.schema, env.sourceRca.table]
  );
  const columns = result.rows.map((row) => row.column_name);
  const found = candidates.find((candidate) => columns.some((column) => column.toLowerCase() === candidate.toLowerCase()));
  if (!found) {
    throw new Error(`Coluna nao encontrada na origem: ${candidates.join(" ou ")}`);
  }
  return columns.find((column) => column.toLowerCase() === found.toLowerCase()) || found;
}

async function main() {
  if (!env.sourceRca.databaseUrl) {
    throw new Error("SOURCE_DATABASE_URL nao configurada.");
  }

  const source = new Client({ connectionString: env.sourceRca.databaseUrl });
  await source.connect();

  try {
    const tableRef = `${quoteIdentifier(env.sourceRca.schema)}.${quoteIdentifier(env.sourceRca.table)}`;
    const bloqueioColumn = await findColumn(source, ["BLOQUEIO", "bloqueio"]);
    const timeColumn = await findColumn(source, ["Time", "time", "TIME"]);
    const result = await source.query<SourceRcaRow>(`
      select
        codgerente::int as codgerente,
        coordenador::text as coordenador,
        codsup::int as codsup,
        supervisor::text as supervisor,
        codusur::int as codusur,
        rca::text as rca
      from ${tableRef}
      where lower(coalesce(${quoteIdentifier(bloqueioColumn)}::text, '')) = 'n'
        and lower(coalesce(${quoteIdentifier(timeColumn)}::text, '')) <> 'outros'
      order by codsup, rca
    `);

    await prisma.$transaction(async (tx) => {
      await tx.baseRca.deleteMany();
      if (result.rows.length) {
        await tx.baseRca.createMany({
          data: result.rows.map((row) => ({
            codgerente: row.codgerente,
            coordenador: row.coordenador,
            codsup: row.codsup,
            supervisor: row.supervisor,
            codusur: row.codusur,
            rca: row.rca
          }))
        });
      }
    });

    console.log("Solicitacoes-Trade | base_rca atualizada no Railway.");
    console.log(`RCAs ativos reinseridos: ${result.rows.length}`);
  } finally {
    await source.end();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
