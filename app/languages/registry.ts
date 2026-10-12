import type { TrainingLanguage } from "../core/comparison";
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
  const module = registry.resolve(languageId, ref) as typeof english &
    Partial<TrainingLanguage>;
  if (
    !module.capabilities.training ||
    !module.prepare ||
    !module.comparePrepared ||
    !module.buildHint
  )
    throw new Error("此语言的训练模块不可用。");
  return module as TrainingLanguage;
}
