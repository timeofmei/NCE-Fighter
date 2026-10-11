import type { ImportLanguage, Registry } from "../core/lesson";

const english: ImportLanguage = {
  languageId: "en",
  label: "英语",
  textDirection: "ltr",
  moduleRef: {
    moduleId: "english-text-import",
    moduleVersion: "1.0.0",
    profileVersion: "1.0.0",
  },
  capabilities: { textImport: true, training: false },
  // Import eligibility only. Comparison and hints belong to a later delivery.
  countUnits(text) {
    return (
      text
        .normalize("NFKC")
        .replace(/['’]/g, "")
        .match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*/gu) ?? []
    ).length;
  },
};
export const registry: Registry = {
  list: () => [english],
  resolve(languageId, ref) {
    if (!languageId) throw new Error("请先选择课文内容语言。");
    if (languageId !== english.languageId) throw new Error("课文语言不可用。");
    if (
      ref &&
      (ref.moduleId !== english.moduleRef.moduleId ||
        ref.moduleVersion !== english.moduleRef.moduleVersion ||
        ref.profileVersion !== english.moduleRef.profileVersion)
    )
      throw new Error("课文所用的语言版本不可用。");
    return english;
  },
};
