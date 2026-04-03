import { describe, expect, it } from "vitest";

import { messages } from "@/lib/i18n/messages";

describe("i18n messages", () => {
  it("zh and en have the same keys", () => {
    const zhKeys = Object.keys(messages.zh).sort();
    const enKeys = Object.keys(messages.en).sort();
    expect(zhKeys).toEqual(enKeys);
  });

  it("no empty values in zh", () => {
    for (const [key, value] of Object.entries(messages.zh)) {
      expect(value, `zh.${key} should not be empty`).toBeTruthy();
    }
  });

  it("no empty values in en", () => {
    for (const [key, value] of Object.entries(messages.en)) {
      expect(value, `en.${key} should not be empty`).toBeTruthy();
    }
  });

  it("has required nav keys", () => {
    const requiredKeys = [
      "nav.marketSignals",
      "nav.options",
      "nav.insider",
      "nav.sentiment",
      "nav.logout",
    ];
    for (const key of requiredKeys) {
      expect(messages.zh).toHaveProperty(key);
      expect(messages.en).toHaveProperty(key);
    }
  });
});
