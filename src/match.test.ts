import { describe, it, expect } from "vitest";
import { Match } from "./match";

// Test union types
type Event =
  | { _tag: "UserCreated"; userId: string; name: string }
  | { _tag: "UserUpdated"; userId: string; changes: Record<string, unknown> }
  | { _tag: "UserDeleted"; userId: string };

type Status =
  | { _tag: "Pending" }
  | { _tag: "Running"; progress: number }
  | { _tag: "Completed"; result: string }
  | { _tag: "Failed"; error: string };

describe("Match", () => {
  describe("exhaustive matching", () => {
    it("matches all cases of a union", () => {
      const handleEvent = (event: Event): string =>
        Match.value(event)
          .pipe(Match.tag("UserCreated", (e) => `Created user ${e.name}`))
          .pipe(Match.tag("UserUpdated", (e) => `Updated user ${e.userId}`))
          .pipe(Match.tag("UserDeleted", (e) => `Deleted user ${e.userId}`))
          .pipe(Match.exhaustive);

      const created: Event = { _tag: "UserCreated", userId: "1", name: "Alice" };
      const updated: Event = { _tag: "UserUpdated", userId: "1", changes: { name: "Bob" } };
      const deleted: Event = { _tag: "UserDeleted", userId: "1" };

      expect(handleEvent(created)).toBe("Created user Alice");
      expect(handleEvent(updated)).toBe("Updated user 1");
      expect(handleEvent(deleted)).toBe("Deleted user 1");
    });

    it("works with more complex unions", () => {
      const getStatusMessage = (status: Status): string =>
        Match.value(status)
          .pipe(Match.tag("Pending", () => "Waiting to start"))
          .pipe(Match.tag("Running", (s) => `Progress: ${s.progress}%`))
          .pipe(Match.tag("Completed", (s) => `Done: ${s.result}`))
          .pipe(Match.tag("Failed", (s) => `Error: ${s.error}`))
          .pipe(Match.exhaustive);

      expect(getStatusMessage({ _tag: "Pending" })).toBe("Waiting to start");
      expect(getStatusMessage({ _tag: "Running", progress: 50 })).toBe("Progress: 50%");
      expect(getStatusMessage({ _tag: "Completed", result: "success" })).toBe("Done: success");
      expect(getStatusMessage({ _tag: "Failed", error: "timeout" })).toBe("Error: timeout");
    });
  });

  describe("tags - batch matching", () => {
    it("matches multiple tags at once", () => {
      const handleEvent = (event: Event): string =>
        Match.value(event)
          .pipe(
            Match.tags({
              UserCreated: (e) => `Created: ${e.name}`,
              UserUpdated: (e) => `Updated: ${e.userId}`,
              UserDeleted: (e) => `Deleted: ${e.userId}`,
            })
          )
          .pipe(Match.exhaustive);

      const created: Event = { _tag: "UserCreated", userId: "1", name: "Alice" };
      expect(handleEvent(created)).toBe("Created: Alice");
    });
  });

  describe("orElse - default handling", () => {
    it("uses default handler for unmatched cases", () => {
      const handleStatus = (status: Status): string =>
        Match.value(status)
          .pipe(Match.tag("Completed", (s) => `Done: ${s.result}`))
          .pipe(Match.orElse((s) => `Status: ${s._tag}`));

      expect(handleStatus({ _tag: "Completed", result: "ok" })).toBe("Done: ok");
      expect(handleStatus({ _tag: "Pending" })).toBe("Status: Pending");
      expect(handleStatus({ _tag: "Running", progress: 50 })).toBe("Status: Running");
    });
  });

  describe("orElseValue - default value", () => {
    it("returns default value for unmatched cases", () => {
      const handleStatus = (status: Status): string =>
        Match.value(status)
          .pipe(Match.tag("Completed", (s) => s.result))
          .pipe(Match.orElseValue("not completed"));

      expect(handleStatus({ _tag: "Completed", result: "success" })).toBe("success");
      expect(handleStatus({ _tag: "Pending" })).toBe("not completed");
    });
  });

  describe("is - type guard", () => {
    it("narrows type correctly", () => {
      const event: Event = { _tag: "UserCreated", userId: "1", name: "Alice" };

      if (Match.is<Event, "UserCreated">("UserCreated")(event)) {
        // TypeScript should know event.name exists
        expect(event.name).toBe("Alice");
      }
    });

    it("returns false for non-matching tags", () => {
      const event: Event = { _tag: "UserDeleted", userId: "1" };
      expect(Match.is<Event, "UserCreated">("UserCreated")(event)).toBe(false);
    });
  });

  describe("isOneOf - multiple tag check", () => {
    it("matches any of the specified tags", () => {
      const isModification = Match.isOneOf<Event, ("UserCreated" | "UserUpdated")[]>(
        "UserCreated",
        "UserUpdated"
      );

      expect(isModification({ _tag: "UserCreated", userId: "1", name: "Alice" })).toBe(true);
      expect(isModification({ _tag: "UserUpdated", userId: "1", changes: {} })).toBe(true);
      expect(isModification({ _tag: "UserDeleted", userId: "1" })).toBe(false);
    });
  });

  describe("when - conditional matching", () => {
    it("applies predicate when there is a fallback handler", () => {
      type User = { _tag: "User"; name: string; isAdmin: boolean };
      type Person = User;

      // When used with an existing handler for the same tag, `when` provides conditional override
      const greetAdmins = (person: Person): string =>
        Match.value(person)
          .pipe(Match.tag("User", (u) => `Hello ${u.name}`)) // Base case first
          .pipe(
            Match.when(
              "User",
              (u) => u.isAdmin,
              (u) => `Hello Admin ${u.name}!`
            )
          )
          .pipe(Match.exhaustive);

      expect(greetAdmins({ _tag: "User", name: "Alice", isAdmin: true })).toBe("Hello Admin Alice!");
      expect(greetAdmins({ _tag: "User", name: "Bob", isAdmin: false })).toBe("Hello Bob");
    });
  });

  describe("chaining with pipe", () => {
    it("chains multiple operations fluently", () => {
      const result = Match.value<Status>({ _tag: "Running", progress: 75 })
        .pipe(Match.tag("Pending", () => 0))
        .pipe(Match.tag("Running", (s) => s.progress))
        .pipe(Match.tag("Completed", () => 100))
        .pipe(Match.tag("Failed", () => -1))
        .pipe(Match.exhaustive);

      expect(result).toBe(75);
    });
  });
});
