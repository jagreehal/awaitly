/**
 * Asserts the vendored Standard Schema interface stays structurally
 * interchangeable with the real `@standard-schema/spec`.
 *
 * The spec package is a devDependency on purpose: awaitly ships the copy so
 * consumers never need the package, and this file is the tripwire that catches
 * drift if the spec revs. It is type-level only and emits no runtime code.
 */

import type { StandardSchemaV1 as Spec } from "@standard-schema/spec";
import type { StandardSchemaV1 as Vendored } from "./standard-schema";
import { validateInput } from "./validation";

// Assignable in both directions, so either type can be passed wherever the
// other is expected.
const specToVendored = (schema: Spec<{ id: string }>): Vendored<{ id: string }> => schema;
const vendoredToSpec = (schema: Vendored<{ id: string }>): Spec<{ id: string }> => schema;

// The inference helpers agree.
type SpecIn = Spec.InferInput<Spec<{ id: string }, { id: number }>>;
type VendoredIn = Vendored.InferInput<Vendored<{ id: string }, { id: number }>>;
type SpecOut = Spec.InferOutput<Spec<{ id: string }, { id: number }>>;
type VendoredOut = Vendored.InferOutput<Vendored<{ id: string }, { id: number }>>;

const inMatches: SpecIn = null as unknown as VendoredIn;
const outMatches: SpecOut = null as unknown as VendoredOut;

// A schema typed by the real spec still satisfies awaitly's public signature.
const acceptsRealSpec = async (schema: Spec<{ id: string }>) =>
  validateInput(schema, { id: "1" });

export type { SpecIn, VendoredIn, SpecOut, VendoredOut };
export { specToVendored, vendoredToSpec, inMatches, outMatches, acceptsRealSpec };
