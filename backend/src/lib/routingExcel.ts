import XLSX from "xlsx";

export const VALID_DAYS = ["Segunda-Feira", "Terça-Feira", "Quarta-Feira", "Quinta-Feira", "Sexta-Feira", "Sábado"];
export const VALID_TYPES = ["Semanal", "Quinzena 1 (Ímpar)", "Quinzena 2 (Par)"];

const dayAliases = new Map(
  [
    ["segunda", "Segunda-Feira"],
    ["segunda-feira", "Segunda-Feira"],
    ["terca", "Terça-Feira"],
    ["terça", "Terça-Feira"],
    ["terca-feira", "Terça-Feira"],
    ["terça-feira", "Terça-Feira"],
    ["quarta", "Quarta-Feira"],
    ["quarta-feira", "Quarta-Feira"],
    ["quinta", "Quinta-Feira"],
    ["quinta-feira", "Quinta-Feira"],
    ["sexta", "Sexta-Feira"],
    ["sexta-feira", "Sexta-Feira"],
    ["sabado", "Sábado"],
    ["sábado", "Sábado"]
  ].map(([key, value]) => [normalizeText(key), value])
);

const typeAliases = new Map(
  [
    ["semanal", "Semanal"],
    ["quinzena 1", "Quinzena 1 (Ímpar)"],
    ["quinzena 1 impar", "Quinzena 1 (Ímpar)"],
    ["quinzena 1 ímpar", "Quinzena 1 (Ímpar)"],
    ["impar", "Quinzena 1 (Ímpar)"],
    ["ímpar", "Quinzena 1 (Ímpar)"],
    ["quinzena 2", "Quinzena 2 (Par)"],
    ["quinzena 2 par", "Quinzena 2 (Par)"],
    ["par", "Quinzena 2 (Par)"]
  ].map(([key, value]) => [normalizeText(key), value])
);

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[()]/g, "")
    .replace(/\s+/g, " ");
}

function pick(row: Record<string, unknown>, aliases: string[]): unknown {
  const normalizedAliases = aliases.map(normalizeText);
  const foundKey = Object.keys(row).find((key) => normalizedAliases.includes(normalizeText(key)));
  return foundKey ? row[foundKey] : undefined;
}

export function normalizeDay(value: unknown): string {
  const normalized = normalizeText(value);
  return dayAliases.get(normalized) || String(value || "").trim();
}

export function normalizeType(value: unknown): string {
  const normalized = normalizeText(value);
  return typeAliases.get(normalized) || String(value || "").trim();
}

export type RoutingExcelRow = {
  codgerente: number | null;
  coordenador: string | null;
  codsup: number | null;
  supervisor: string | null;
  codusur: number;
  rca: string;
  codcli: number;
  cliente: string;
  dia: string;
  tipo: string;
  rowNumber: number;
};

export function readRoutingWorkbook(filePath: string): RoutingExcelRow[] {
  const workbook = XLSX.readFile(filePath, { cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

  return rows.map((row, index) => {
    const codgerenteRaw = Number(pick(row, ["codgerente", "cod gerente", "gerente"]));
    const codsupRaw = Number(pick(row, ["codsup", "cod supervisor", "codigo supervisor"]));
    const parsed = {
      codgerente: Number.isInteger(codgerenteRaw) ? codgerenteRaw : null,
      coordenador: String(pick(row, ["coordenador"]) || "").trim() || null,
      codsup: Number.isInteger(codsupRaw) ? codsupRaw : null,
      supervisor: String(pick(row, ["supervisor"]) || "").trim() || null,
      codusur: Number(pick(row, ["codusur", "cod rca", "codigo rca", "vendedor"])),
      rca: String(pick(row, ["rca", "vendedor", "nome rca"]) || "").trim(),
      codcli: Number(pick(row, ["codcli", "cod cliente", "codigo cliente", "cliente codigo"])),
      cliente: String(pick(row, ["cliente", "nome cliente", "razao social", "razao"]) || "").trim(),
      dia: normalizeDay(pick(row, ["dia", "dia semana", "dia da semana", "dia roteirizado"])),
      tipo: normalizeType(pick(row, ["tipo", "frequencia", "quinzena", "obs", "observacao"])),
      rowNumber: index + 2
    };

    if (!Number.isInteger(parsed.codusur) || !Number.isInteger(parsed.codcli)) {
      throw new Error(`Linha ${parsed.rowNumber}: codusur e codcli sao obrigatorios.`);
    }

    if (!VALID_DAYS.includes(parsed.dia)) {
      throw new Error(`Linha ${parsed.rowNumber}: dia invalido (${parsed.dia}).`);
    }

    if (!VALID_TYPES.includes(parsed.tipo)) {
      throw new Error(`Linha ${parsed.rowNumber}: tipo invalido (${parsed.tipo}).`);
    }

    return parsed;
  });
}
