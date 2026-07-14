import "../src/config";
import { Client } from "pg";
import { env } from "../src/config";
import { readRoutingWorkbook } from "../src/lib/routingExcel";

type BaseRcaRow = {
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

async function findColumn(source: Client, schema: string, table: string, candidates: string[]): Promise<string> {
  const result = await source.query<{ column_name: string }>(
    `
      select column_name
      from information_schema.columns
      where table_schema = $1
        and table_name = $2
    `,
    [schema, table]
  );
  const columns = result.rows.map((row) => row.column_name);
  const found = candidates.find((candidate) => columns.some((column) => column.toLowerCase() === candidate.toLowerCase()));
  if (!found) {
    throw new Error(`Coluna nao encontrada na origem: ${candidates.join(" ou ")}`);
  }
  return columns.find((column) => column.toLowerCase() === found.toLowerCase()) || found;
}

async function readBaseRcaAtiva(source: Client): Promise<Map<number, BaseRcaRow>> {
  const tableRef = `${quoteIdentifier(env.sourceRca.schema)}.${quoteIdentifier(env.sourceRca.table)}`;
  const bloqueioColumn = await findColumn(source, env.sourceRca.schema, env.sourceRca.table, ["BLOQUEIO", "bloqueio"]);
  const timeColumn = await findColumn(source, env.sourceRca.schema, env.sourceRca.table, ["Time", "time", "TIME"]);
  const result = await source.query<BaseRcaRow>(`
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
  `);

  return new Map(result.rows.map((row) => [row.codusur, row]));
}

async function ensureLocalRoutingTable(source: Client): Promise<void> {
  const schema = quoteIdentifier(env.sourceRouting.schema);
  const table = quoteIdentifier(env.sourceRouting.table);
  await source.query(`create schema if not exists ${schema}`);
  await source.query(`
    create table if not exists ${schema}.${table} (
      codgerente int,
      coordenador text,
      codsup int not null,
      supervisor text not null,
      codusur int not null,
      rca text not null,
      codcli int not null,
      cliente text not null,
      dia text not null,
      tipo text not null,
      data_alteracao timestamptz not null default now(),
      constraint "fRoteirizacao_pk" primary key (codusur, codcli)
    )
  `);
  await source.query(`
    create or replace function ${schema}.solicitacoes_trade_set_data_alteracao()
    returns trigger as $$
    begin
      new.data_alteracao = now();
      return new;
    end;
    $$ language plpgsql
  `);
  await source.query(`drop trigger if exists solicitacoes_trade_set_data_alteracao on ${schema}.${table}`);
  await source.query(`
    create trigger solicitacoes_trade_set_data_alteracao
    before update on ${schema}.${table}
    for each row
    when (old.* is distinct from new.*)
    execute function ${schema}.solicitacoes_trade_set_data_alteracao()
  `);
}

async function main() {
  if (!env.sourceRca.databaseUrl) {
    throw new Error("SOURCE_DATABASE_URL nao configurada.");
  }

  const filePath = process.argv[2] || "C:\\Users\\POWERBI\\Desktop\\Rota completa.xlsx";
  const rows = readRoutingWorkbook(filePath);
  const source = new Client({ connectionString: env.sourceRca.databaseUrl });
  await source.connect();
  await source.query("set time zone 'America/Fortaleza'");

  try {
    const baseRca = await readBaseRcaAtiva(source);
    await ensureLocalRoutingTable(source);

    const skippedRcas = new Set<number>();
    let imported = 0;

    await source.query("begin");
    await source.query(`truncate table ${quoteIdentifier(env.sourceRouting.schema)}.${quoteIdentifier(env.sourceRouting.table)}`);

    for (const row of rows) {
      const rca = baseRca.get(row.codusur);
      if (!rca) {
        skippedRcas.add(row.codusur);
        continue;
      }

      await source.query(
        `
          insert into ${quoteIdentifier(env.sourceRouting.schema)}.${quoteIdentifier(env.sourceRouting.table)} (
            codgerente, coordenador, codsup, supervisor, codusur, rca, codcli, cliente, dia, tipo, data_alteracao
          )
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
          on conflict (codusur, codcli) do update set
            codgerente = excluded.codgerente,
            coordenador = excluded.coordenador,
            codsup = excluded.codsup,
            supervisor = excluded.supervisor,
            rca = excluded.rca,
            cliente = excluded.cliente,
            dia = excluded.dia,
            tipo = excluded.tipo,
            data_alteracao = now()
        `,
        [
          rca.codgerente,
          rca.coordenador,
          rca.codsup,
          rca.supervisor,
          row.codusur,
          rca.rca,
          row.codcli,
          row.cliente || `Cliente ${row.codcli}`,
          row.dia,
          row.tipo
        ]
      );
      imported += 1;
    }

    await source.query("commit");
    console.log("Solicitacoes-Trade | fRoteirizacao local alimentada.");
    console.log(`Linhas lidas no Excel: ${rows.length}`);
    console.log(`Linhas importadas/atualizadas: ${imported}`);
    console.log(`RCAs ignorados por nao estarem ativos na base RCA: ${Array.from(skippedRcas).sort((a, b) => a - b).join(", ") || "nenhum"}`);
  } catch (error) {
    await source.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await source.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
