import type { Language } from "@/types/domain";

import { en } from "./en";
import { es, type TranslationKey } from "./es";

export type Translations = Record<TranslationKey, string>;

const DICT: Record<Language, Translations> = { es, en };

export function getTranslations(lang: Language): Translations {
  return DICT[lang];
}

export type { TranslationKey };
