import type { UserData } from "../core/user-data";

export async function systemInfo(): Promise<UserData["system"]> {
  const info = (
    navigator as Navigator & {
      userAgentData?: {
        platform?: string;
        getHighEntropyValues?(
          keys: string[],
        ): Promise<{ platformVersion?: string }>;
      };
    }
  ).userAgentData;
  let version: string | null = null;
  try {
    const values = await info?.getHighEntropyValues?.(["platformVersion"]);
    version = values?.platformVersion || null;
  } catch {
    /* Unavailable system metadata must never block export. */
  }
  return { name: info?.platform || null, version };
}
