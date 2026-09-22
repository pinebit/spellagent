// Development quality harness only. Compares model proposals against labeled gold corrections.
export function scoreQuality(gold, predictions) {
  const predByPath = new Map(predictions.map((p) => [p.path, p]));
  let truePositives = 0;
  let falseNegatives = 0;
  let falsePositives = 0;
  const unexpectedChanges = [];

  for (const file of gold) {
    const prediction = predByPath.get(file.path) ?? { path: file.path, proposals: [] };
    const remainingProposals = [...prediction.proposals];
    for (const expected of file.corrections) {
      const index = remainingProposals.findIndex(
        (p) => p.original === expected.original && p.replacement === expected.replacement,
      );
      if (index >= 0) {
        truePositives += 1;
        remainingProposals.splice(index, 1);
      } else {
        falseNegatives += 1;
      }
    }
    for (const leftover of remainingProposals) {
      falsePositives += 1;
      unexpectedChanges.push({ path: file.path, original: leftover.original, replacement: leftover.replacement });
    }
  }

  const precision = truePositives + falsePositives === 0 ? 1 : truePositives / (truePositives + falsePositives);
  const recall = truePositives + falseNegatives === 0 ? 1 : truePositives / (truePositives + falseNegatives);
  return { precision, recall, truePositives, falsePositives, falseNegatives, unexpectedChanges };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [goldPath, predictionsPath] = process.argv.slice(2);
  const { readFile } = await import('node:fs/promises');
  const gold = JSON.parse(await readFile(goldPath, 'utf8'));
  const predictions = JSON.parse(await readFile(predictionsPath, 'utf8'));
  const result = scoreQuality(gold, predictions);
  console.log(JSON.stringify(result, null, 2));
}
