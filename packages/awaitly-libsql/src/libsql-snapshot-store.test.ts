import { describe, it, expect } from "vitest";
import { libsql } from "./index";

describe("libsql() SnapshotStore", () => {
  describe("table name validation (SQL injection prevention)", () => {
    it("should throw when table name contains SQL injection payload", () => {
      expect(() =>
        libsql({
          url: "file::memory:",
          table: "x); DROP TABLE users;--",
        })
      ).toThrow(/Invalid table name/);
    });

    it("should throw when table name contains semicolon", () => {
      expect(() =>
        libsql({
          url: "file::memory:",
          table: "awaitly_snapshots; DELETE FROM",
        })
      ).toThrow(/Invalid table name/);
    });

    it("should throw when table name contains spaces", () => {
      expect(() =>
        libsql({
          url: "file::memory:",
          table: "my snapshots",
        })
      ).toThrow(/Invalid table name/);
    });

    it("should throw when table name starts with number", () => {
      expect(() =>
        libsql({
          url: "file::memory:",
          table: "42_snapshots",
        })
      ).toThrow(/Invalid table name/);
    });

    it("should accept valid alphanumeric table name", () => {
      const store = libsql({
        url: "file::memory:",
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
      const store = libsql("file::memory:");
      expect(store).toBeDefined();
    });
  });
});
