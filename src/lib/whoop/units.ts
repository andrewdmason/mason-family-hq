// WHOOP's lift payload wants weight in kilograms; our sets store lb (default) or
// kg. Keep the conversion factor consistent with e1rm.ts's KG_TO_LB.

const KG_TO_LB = 2.2046226218;

/** Convert a logged load to kilograms, rounded to 0.1. */
export function toKg(load: number, unit: "lb" | "kg" | null | undefined): number {
  const kg = unit === "kg" ? load : load / KG_TO_LB;
  return Math.round(kg * 10) / 10;
}
