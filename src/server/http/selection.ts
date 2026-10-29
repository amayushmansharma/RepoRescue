import { ApiError, ensureObject, ensureString, ensureStringArray, readJsonBody } from "./errors";

export type SelectionPayload = { scanId: string; findingIds: string[]; verificationId?: string };

/**
 * Selection endpoints only accept identifiers. Patches and validation results
 * are always regenerated server-side from the stored scan, so a client cannot
 * claim that arbitrary content was validated.
 */
export async function readSelection(request: Request): Promise<SelectionPayload> {
  const body = ensureObject(await readJsonBody(request), "body");
  const scanId = ensureString(body.scanId, "scanId", { max: 64 });
  if (!Array.isArray(body.findingIds)) {
    throw new ApiError("INVALID_INPUT", '"findingIds" must be an array of finding identifiers.', { details: { field: "findingIds" } });
  }
  const findingIds = ensureStringArray(body.findingIds, "findingIds", { minItems: 1, maxItems: 30, itemMaxLength: 80 });
  const verificationId = typeof body.verificationId === "string" && body.verificationId.trim() ? body.verificationId.trim() : undefined;
  return { scanId, findingIds, verificationId };
}
