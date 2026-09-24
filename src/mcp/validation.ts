import { z } from "zod";

export class SwiggyResponseError extends Error {
  constructor(readonly tool: string, readonly fields: string[]) {
    super(`Swiggy ${tool} returned an unexpected format: ${fields.join("; ")}.`);
  }
}

export function parseToolData<T extends z.ZodTypeAny>(tool: string, schema: T, value: unknown): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  // Only field paths and type names; never response values or account details.
  const fields = parsed.error.issues.slice(0, 8).map((issue) => {
    const field = issue.path.join(".") || "response";
    return issue.code === "invalid_type"
      ? `${field} (expected ${issue.expected}, received ${issue.received})`
      : `${field} (${issue.code})`;
  });
  throw new SwiggyResponseError(tool, fields);
}
