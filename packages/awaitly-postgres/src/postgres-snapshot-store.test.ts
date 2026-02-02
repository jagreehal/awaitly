import { describe, it, expect } from "vitest";
import { postgres } from "./index";

describe("postgres() SnapshotStore", () => {
  describe("table name validation (SQL injection prevention)", () => {
    it("should throw when table name contains SQL injection payload", () => {
      expect(() =>
        postgres({
          url: "postgresql://localhost/mydb",
          table: "x); DROP TABLE users;--",
        })
      ).toThrow(/Invalid table name/);
    });

    it("should throw when table name contains semicolon", () => {
      expect(() =>
        postgres({
          url: "postgresql://localhost/mydb",
          table: "awaitly_snapshots; DELETE FROM",
        })
      ).toThrow(/Invalid table name/);
    });

    it("should throw when table name contains spaces", () => {
      expect(() =>
        postgres({
          url: "postgresql://localhost/mydb",
          table: "my snapshots",
        })
      ).toThrow(/Invalid table name/);
    });

    it("should throw when table name starts with number", () => {
      expect(() =>
        postgres({
          url: "postgresql://localhost/mydb",
          table: "42_snapshots",
        })
      ).toThrow(/Invalid table name/);
    });

    it("should accept valid alphanumeric table name", () => {
      const store = postgres({
        url: "postgresql://localhost/mydb",
        table: "my_workflow_snapshots",
      });
      expect(store).toBeDefined();
      expect(store.save).toBeDefined();
      expect(store.load).toBeDefined();
      expect(store.delete).toBeDefined();
      expect(store.list).toBeDefined();
      expect(store.close).toBeDefined();
    });

    it("should accept default table name (string shorthand)", () => {
      const store = postgres("postgresql://localhost/mydb");
      expect(store).toBeDefined();
    });
  });
});
