import { z } from "zod";
import { day } from "../../src/lib/operations/model";
/** Explicit historical fixture dates keep repeat runs within real scheduling capacity. */
export function acceptanceDate(variable: string, fallback: string) {
  const value = z.iso.date().parse(process.env[variable] ?? fallback);
  if (value > day())
    throw Error("Acceptance event date must not be in the future");
  return value;
}
