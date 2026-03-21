/**
 * Optional input validation using the Standard Schema spec.
 * Works with Zod, Valibot, ArkType, or any Standard Schema-compliant library.
 *
 * @see https://github.com/standard-schema/standard-schema
 */

import type { StandardSchemaV1 } from "@standard-schema/spec";
import { ok, err, type Result } from "../core";

/**
 * Tagged error returned when workflow input fails schema validation.
 * Follows awaitly's tagged error object pattern (with `type` field).
 */
export type InputValidationError = {
  type: "INPUT_VALIDATION_ERROR";
  issues: Array<{ message: string; path?: Array<string | number> }>;
  message: string;
};

/**
 * Type guard for InputValidationError.
 */
export function isInputValidationError(e: unknown): e is InputValidationError {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as InputValidationError).type === "INPUT_VALIDATION_ERROR"
  );
}

/**
 * Validate input against a Standard Schema.
 * Supports both sync and async schema validation.
 *
 * @param schema - A Standard Schema-compliant schema object
 * @param input - The input value to validate
 * @returns Result with validated value or InputValidationError
 */
export async function validateInput<T>(
  schema: StandardSchemaV1<T>,
  input: unknown
): Promise<Result<T, InputValidationError>> {
  const result = schema["~standard"].validate(input);
  // Standard Schema allows sync or async validation
  const resolved = result instanceof Promise ? await result : result;
  if (resolved.issues) {
    return err({
      type: "INPUT_VALIDATION_ERROR" as const,
      issues: resolved.issues.map((i) => ({
        message: i.message,
        path: i.path?.map((p) =>
          typeof p === "object" ? (p as { key: string | number }).key : p
        ) as Array<string | number> | undefined,
      })),
      message: `Input validation failed: ${resolved.issues.map((i) => i.message).join(", ")}`,
    });
  }
  return ok(resolved.value as T);
}
