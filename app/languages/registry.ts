import type { Registry } from "../core/lesson";
import { english } from "./english";
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
export function trainingModule(
  languageId: string,
  ref?: Parameters<Registry["resolve"]>[1],
) {
  registry.resolve(languageId, ref);
  return english;
}
