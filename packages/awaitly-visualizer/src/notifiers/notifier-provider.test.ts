import { describe, it, expect } from "vitest";
import { createSlackNotifier } from "./slack";
import { createDiscordNotifier } from "./discord";
import { createWebhookNotifier } from "./webhook";

describe("Notifiers require explicit diagramProvider", () => {
  describe("SlackNotifier", () => {
    it("throws at runtime if diagramProvider is missing (JS consumer simulation)", () => {
      // TypeScript would catch this at compile time, but JS consumers need runtime validation
      expect(() =>
        createSlackNotifier({
          token: "xoxb-test",
          channel: "#test",
          // diagramProvider intentionally omitted
        } as any)
      ).toThrow("SlackNotifier: diagramProvider is required");
    });

    it("works when diagramProvider is provided", () => {
      const mockClient = {
        chat: {
          postMessage: async () => ({ ok: true, ts: "123" }),
          update: async () => ({ ok: true }),
        },
      };

      const notifier = createSlackNotifier(
        {
          token: "xoxb-test",
          channel: "#test",
          diagramProvider: { provider: "kroki" },
        },
        { client: mockClient }
      );

      expect(notifier.getType()).toBe("slack");
    });
  });

  describe("DiscordNotifier", () => {
    it("throws at runtime if diagramProvider is missing (JS consumer simulation)", () => {
      expect(() =>
        createDiscordNotifier({
          webhookUrl: "https://discord.com/api/webhooks/123/abc",
          // diagramProvider intentionally omitted
        } as any)
      ).toThrow("DiscordNotifier: diagramProvider is required");
    });

    it("works when diagramProvider is provided", () => {
      const notifier = createDiscordNotifier({
        webhookUrl: "https://discord.com/api/webhooks/123/abc",
        diagramProvider: { provider: "kroki" },
      });

      expect(notifier.getType()).toBe("discord");
    });
  });

  describe("WebhookNotifier", () => {
    it("throws at runtime if diagramProvider is missing (JS consumer simulation)", () => {
      expect(() =>
        createWebhookNotifier({
          url: "https://example.com/webhook",
          // diagramProvider intentionally omitted
        } as any)
      ).toThrow("WebhookNotifier: diagramProvider is required");
    });

    it("works when diagramProvider is provided", () => {
      const notifier = createWebhookNotifier({
        url: "https://example.com/webhook",
        diagramProvider: { provider: "mermaid-ink" },
      });

      expect(notifier.getType()).toBe("webhook");
    });
  });
});
