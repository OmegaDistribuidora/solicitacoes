export const FORTALEZA_TIME_ZONE = "America/Fortaleza";

export function nowFortaleza(): Date {
  return new Date();
}

export function formatFortalezaDateTime(date: Date | string | null | undefined): string {
  if (!date) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: FORTALEZA_TIME_ZONE,
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(date));
}
