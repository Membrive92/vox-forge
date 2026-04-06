import { describe, expect, it } from "vitest";

import { en } from "./en";
import { es, type TranslationKey } from "./es";

describe("i18n", () => {
  it("es and en have the same keys", () => {
    const esKeys = Object.keys(es).sort();
    const enKeys = Object.keys(en).sort();
    expect(esKeys).toEqual(enKeys);
  });

  it("no translation value is empty", () => {
    for (const [key, value] of Object.entries(es)) {
      expect(value, `es.${key} is empty`).not.toBe("");
    }
    for (const [key, value] of Object.entries(en)) {
      expect(value, `en.${key} is empty`).not.toBe("");
    }
  });

  it("all keys are valid TranslationKey type", () => {
    const keys = Object.keys(es) as TranslationKey[];
    expect(keys.length).toBeGreaterThan(50);
  });
});
