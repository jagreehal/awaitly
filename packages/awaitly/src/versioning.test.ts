/**
 * Workflow state versioning and migration.
 *
 * Mutation testing reported this module at 0%: 151 mutants, not one covered,
 * in code that ships publicly through `awaitly/durable`. It decides what
 * happens to a workflow that was persisted by one deploy and resumed by the
 * next, so every branch here is a decision about state that is already on
 * disk.
 */

import { describe, it, expect } from "vitest";
import { ok, err } from "./core";
import type { ResumeState, ResumeStateEntry } from "./workflow/types";
import {
  migrateState,
  createVersionedStateLoader,
  createVersionedState,
  parseVersionedState,
  stringifyVersionedState,
  createKeyRenameMigration,
  createKeyRemoveMigration,
  createValueTransformMigration,
  composeMigrations,
  isMigrationError,
  isVersionIncompatibleError,
  type MigrationError,
  type VersionIncompatibleError,
} from "./versioning";

function state(entries: Record<string, unknown> = { "step:a": "value-a" }): ResumeState {
  const steps = new Map<string, ResumeStateEntry>();
  for (const [key, value] of Object.entries(entries)) {
    steps.set(key, { result: ok(value) });
  }
  return { steps };
}

const keys = (s: ResumeState) => [...s.steps.keys()].sort();

describe("migrateState", () => {
  it("returns the state untouched when it is already at the target version", async () => {
    const original = state();
    const result = await migrateState({ version: 3, state: original }, 3, {});

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.version).toBe(3);
    expect(result.value.state).toBe(original);
  });

  it("refuses to downgrade state written by a newer deploy", async () => {
    // The old code cannot know what the new version put in the snapshot, so
    // reading it anyway is how a resumed workflow acts on state it misreads.
    const result = await migrateState({ version: 5, state: state() }, 3, {});

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isVersionIncompatibleError(result.error)).toBe(true);
    const error = result.error as VersionIncompatibleError;
    expect(error.stateVersion).toBe(5);
    expect(error.currentVersion).toBe(3);
    expect(error.reason).toContain("Cannot downgrade");
  });

  it("applies each migration in order across several versions", async () => {
    const seen: number[] = [];
    const result = await migrateState({ version: 1, state: state() }, 4, {
      1: (s) => {
        seen.push(1);
        return s;
      },
      2: (s) => {
        seen.push(2);
        return s;
      },
      3: (s) => {
        seen.push(3);
        return s;
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(seen).toEqual([1, 2, 3]);
    expect(result.value.version).toBe(4);
  });

  it("carries each migration's output into the next", async () => {
    const result = await migrateState({ version: 1, state: state({ a: 1 }) }, 3, {
      1: createKeyRenameMigration({ a: "b" }),
      2: createKeyRenameMigration({ b: "c" }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(keys(result.value.state)).toEqual(["c"]);
  });

  it("stops at a missing migration rather than skipping a version", async () => {
    // Skipping a gap would hand the workflow state shaped for a version that
    // no migration ever produced.
    const result = await migrateState({ version: 1, state: state() }, 3, {
      1: (s) => s,
      // 2 is missing
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isVersionIncompatibleError(result.error)).toBe(true);
    const error = result.error as VersionIncompatibleError;
    expect(error.reason).toContain("No migration found for version 2 to 3");
    // The reported state version is the one on disk, not how far it got.
    expect(error.stateVersion).toBe(1);
  });

  it("reports a migration that throws, naming the step it failed on", async () => {
    const result = await migrateState({ version: 1, state: state() }, 3, {
      1: (s) => s,
      2: () => {
        throw new Error("column removed");
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isMigrationError(result.error)).toBe(true);
    const error = result.error as MigrationError;
    expect(error.fromVersion).toBe(2);
    expect(error.toVersion).toBe(3);
    expect((error.cause as Error).message).toBe("column removed");
  });

  it("awaits an async migration", async () => {
    const result = await migrateState({ version: 1, state: state({ a: 1 }) }, 2, {
      1: async (s) => {
        await new Promise((r) => setTimeout(r, 5));
        return createKeyRenameMigration({ a: "z" })(s) as ResumeState;
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(keys(result.value.state)).toEqual(["z"]);
  });

  it("reports a rejected async migration as a migration error", async () => {
    const result = await migrateState({ version: 1, state: state() }, 2, {
      1: async () => {
        throw new Error("network");
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isMigrationError(result.error)).toBe(true);
  });
});

describe("createVersionedStateLoader", () => {
  it("returns undefined for absent state rather than failing", async () => {
    const load = createVersionedStateLoader({ version: 2 });

    for (const absent of [null, undefined]) {
      const result = await load(absent);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBeUndefined();
    }
  });

  it("passes matching-version state straight through", async () => {
    const saved = state();
    const load = createVersionedStateLoader({ version: 2 });
    const result = await load({ version: 2, state: saved });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe(saved);
  });

  it("migrates older state up to the current version", async () => {
    const load = createVersionedStateLoader({
      version: 3,
      migrations: {
        1: createKeyRenameMigration({ old: "mid" }),
        2: createKeyRenameMigration({ mid: "new" }),
      },
    });

    const result = await load({ version: 1, state: state({ old: 1 }) });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(keys(result.value!)).toEqual(["new"]);
  });

  it("rejects newer state under strict versioning, which is the default", async () => {
    const load = createVersionedStateLoader({ version: 2 });
    const result = await load({ version: 5, state: state() });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isVersionIncompatibleError(result.error)).toBe(true);
    expect((result.error as VersionIncompatibleError).reason).toContain("newer workflow version");
  });

  it("still refuses to downgrade when strict versioning is off", async () => {
    // strictVersioning only relaxes the loader's own check; migrateState has
    // no path from a higher version down to a lower one either way.
    const load = createVersionedStateLoader({ version: 2, strictVersioning: false });
    const result = await load({ version: 5, state: state() });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect((result.error as VersionIncompatibleError).reason).toContain("Cannot downgrade");
  });

  it("surfaces a migration failure instead of returning partial state", async () => {
    const load = createVersionedStateLoader({
      version: 2,
      migrations: {
        1: () => {
          throw new Error("bad migration");
        },
      },
    });

    const result = await load({ version: 1, state: state() });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isMigrationError(result.error)).toBe(true);
  });

  it("reports a missing migration when none are configured at all", async () => {
    const load = createVersionedStateLoader({ version: 4 });
    const result = await load({ version: 1, state: state() });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isVersionIncompatibleError(result.error)).toBe(true);
  });
});

describe("serialization round-trip", () => {
  it("survives stringify then parse, Map included", async () => {
    const versioned = createVersionedState(state({ "step:a": 1, "step:b": 2 }), 7);
    const parsed = parseVersionedState(stringifyVersionedState(versioned));

    expect(parsed).not.toBeNull();
    expect(parsed!.version).toBe(7);
    expect(parsed!.state.steps).toBeInstanceOf(Map);
    expect(keys(parsed!.state)).toEqual(["step:a", "step:b"]);
    expect(parsed!.state.steps.get("step:a")).toEqual({ result: ok(1) });
  });

  it("preserves a failed step's result", async () => {
    const steps = new Map<string, ResumeStateEntry>([
      ["step:fail", { result: err({ type: "CHARGE_DECLINED" }) }],
    ]);
    const parsed = parseVersionedState(
      stringifyVersionedState(createVersionedState({ steps }, 1))
    );

    expect(parsed!.state.steps.get("step:fail")).toEqual({
      result: err({ type: "CHARGE_DECLINED" }),
    });
  });

  it("createVersionedState pairs the state with the version given", () => {
    const s = state();
    expect(createVersionedState(s, 9)).toEqual({ version: 9, state: s });
  });

  it("accepts an already-parsed object as well as a string", () => {
    const versioned = createVersionedState(state({ a: 1 }), 2);
    const asObject = JSON.parse(stringifyVersionedState(versioned)) as never;

    expect(parseVersionedState(asObject)!.version).toBe(2);
  });
});

describe("parseVersionedState rejects anything it cannot trust", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty string", ""],
    ["malformed json", "{not json"],
    ["a bare array", "[]"],
    ["json null", "null"],
    ["missing version", '{"state":{"steps":[]}}'],
    ["non-numeric version", '{"version":"2","state":{"steps":[]}}'],
    ["missing state", '{"version":1}'],
    ["null state", '{"version":1,"state":null}'],
    ["steps not an array", '{"version":1,"state":{"steps":{}}}'],
  ])("returns null for %s", (_label, input) => {
    // Returning a half-built object here would hand the workflow step results
    // it never saved.
    expect(parseVersionedState(input as string)).toBeNull();
  });

  it("accepts an empty steps array as valid, empty state", () => {
    const parsed = parseVersionedState('{"version":1,"state":{"steps":[]}}');
    expect(parsed).not.toBeNull();
    expect(parsed!.state.steps.size).toBe(0);
  });
});

describe("migration helpers", () => {
  it("createKeyRenameMigration renames only the keys listed", () => {
    const migrated = createKeyRenameMigration({ "user:fetch": "user:load" })(
      state({ "user:fetch": 1, "order:create": 2 })
    ) as ResumeState;

    expect(keys(migrated)).toEqual(["order:create", "user:load"]);
  });

  it("createKeyRenameMigration keeps the entry attached to its new key", () => {
    const migrated = createKeyRenameMigration({ a: "b" })(state({ a: "payload" })) as ResumeState;

    expect(migrated.steps.get("b")).toEqual({ result: ok("payload") });
  });

  it("createKeyRemoveMigration drops the listed keys and keeps the rest", () => {
    const migrated = createKeyRemoveMigration(["deprecated", "old"])(
      state({ deprecated: 1, old: 2, keep: 3 })
    ) as ResumeState;

    expect(keys(migrated)).toEqual(["keep"]);
  });

  it("createKeyRemoveMigration leaves state alone when nothing matches", () => {
    const migrated = createKeyRemoveMigration(["absent"])(state({ a: 1, b: 2 })) as ResumeState;

    expect(keys(migrated)).toEqual(["a", "b"]);
  });

  it("createValueTransformMigration rewrites matched entries and passes others through", () => {
    const migrated = createValueTransformMigration({
      "user:fetch": (entry) => ({ ...entry, result: ok("rewritten") }),
    })(state({ "user:fetch": "original", other: "untouched" })) as ResumeState;

    expect(migrated.steps.get("user:fetch")).toEqual({ result: ok("rewritten") });
    expect(migrated.steps.get("other")).toEqual({ result: ok("untouched") });
  });

  it("composeMigrations applies each in the order given", async () => {
    const composed = composeMigrations([
      createKeyRenameMigration({ a: "b" }),
      createKeyRemoveMigration(["c"]),
    ]);

    const migrated = (await composed(state({ a: 1, c: 2, d: 3 }))) as ResumeState;

    // Renaming after removing would have kept a different set.
    expect(keys(migrated)).toEqual(["b", "d"]);
  });

  it("composeMigrations awaits async members", async () => {
    const order: string[] = [];
    const composed = composeMigrations([
      async (s) => {
        await new Promise((r) => setTimeout(r, 5));
        order.push("first");
        return s;
      },
      (s) => {
        order.push("second");
        return s;
      },
    ]);

    await composed(state());
    expect(order).toEqual(["first", "second"]);
  });

  it("composeMigrations with no members returns the state unchanged", async () => {
    const original = state();
    expect(await composeMigrations([])(original)).toBe(original);
  });

  it("every helper returns a new Map rather than mutating the saved state", async () => {
    const original = state({ a: 1 });
    createKeyRenameMigration({ a: "b" })(original);
    createKeyRemoveMigration(["a"])(original);
    createValueTransformMigration({ a: (e) => ({ ...e, result: ok("x") }) })(original);

    // The caller's snapshot is on its way to disk; a helper editing it in
    // place would persist a migration that was only meant to be attempted.
    expect(keys(original)).toEqual(["a"]);
    expect(original.steps.get("a")).toEqual({ result: ok(1) });
  });
});

describe("error guards", () => {
  it("isMigrationError matches only its own shape", () => {
    expect(isMigrationError({ type: "MIGRATION_ERROR" })).toBe(true);
    expect(isMigrationError({ type: "VERSION_INCOMPATIBLE" })).toBe(false);
    expect(isMigrationError(null)).toBe(false);
    expect(isMigrationError("MIGRATION_ERROR")).toBe(false);
    expect(isMigrationError(undefined)).toBe(false);
  });

  it("isVersionIncompatibleError matches only its own shape", () => {
    expect(isVersionIncompatibleError({ type: "VERSION_INCOMPATIBLE" })).toBe(true);
    expect(isVersionIncompatibleError({ type: "MIGRATION_ERROR" })).toBe(false);
    expect(isVersionIncompatibleError(null)).toBe(false);
    expect(isVersionIncompatibleError("VERSION_INCOMPATIBLE")).toBe(false);
  });
});
