import { createServer } from "vite";
import { performance } from "node:perf_hooks";
import os from "node:os";

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true },
});
try {
  const { english } = await server.ssrLoadModule("/app/languages/english.ts");
  const { characterLanguage } = await server.ssrLoadModule(
    "/tests/fixtures/character-language.ts",
  );
  const benchmarks = [];
  for (const module of [english, characterLanguage]) {
    const words = Array.from({ length: 1000 }, (_, i) => `word${i % 37}`);
    const referenceText =
        module === english ? words.join(" ") : "甲乙丙丁".repeat(250),
      actualText =
        module === english
          ? words.map((w, i) => (i % 17 === 0 ? "changed" : w)).join(" ")
          : "甲乙戊丁".repeat(250);
    const sentence = (text) => [
      { id: "benchmark", order: 0, start: 0, end: Array.from(text).length },
    ];
    const prepare = () => [
      module.prepare(referenceText, sentence(referenceText)),
      module.prepare(actualText, sentence(actualText)),
    ];
    const [reference, actual] = prepare();
    for (let i = 0; i < 10; i++) {
      prepare();
      module.comparePrepared(reference, actual);
    }
    const analysis = [],
      alignment = [];
    for (let i = 0; i < 100; i++) {
      let start = performance.now();
      prepare();
      analysis.push(performance.now() - start);
      start = performance.now();
      module.comparePrepared(reference, actual);
      alignment.push(performance.now() - start);
    }
    const p95 = (values) =>
      values.sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];
    benchmarks.push({
      languageId: module.languageId,
      unitKind: module.unitKind,
      referenceUnits: reference.units.length,
      actualUnits: actual.units.length,
      analysisPairP95Ms: p95(analysis),
      alignmentAndAggregationP95Ms: p95(alignment),
    });
  }
  console.log(
    JSON.stringify(
      {
        cpu: os.cpus()[0].model,
        platform: os.platform(),
        arch: os.arch(),
        node: process.version,
        unicode: process.versions.unicode,
        samples: 100,
        warmups: 10,
        benchmarks,
        alignmentCellLimit: 16_000_000,
      },
      null,
      2,
    ),
  );
} finally {
  await server.close();
}
