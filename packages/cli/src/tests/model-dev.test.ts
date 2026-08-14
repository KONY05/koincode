import path from "path";
import fs from "fs/promises";
import os from "os";

const ModelDevPath = path.join(os.homedir(), "/.koincode/models-dev.json");

async function findModel(provider: string, modelName: string) {
  const modelData = JSON.parse(await fs.readFile(ModelDevPath, "utf8"));
  let foundModel = null;
  const providerGroup = modelData[provider];

  if (providerGroup.models) {
    foundModel = providerGroup.models[modelName];
  }

  if (!foundModel) {
    for (const pKey of Object.keys(modelData)) {
      const pEntry = modelData[pKey];
      if (pEntry?.models) {
        if (pEntry.models[modelName]) {
          foundModel = pEntry.models[modelName];
          break;
        }
        for (const mKey of Object.keys(pEntry.models)) {
          const m = pEntry.models[mKey];
          if (m?.id === modelName) {
            foundModel = m;
            break;
          }
        }
        if (foundModel) break;
      }
    }
  }

  if (!foundModel) {
    console.log("Model not found", modelName);
    return;
  }

  console.log({
    id: foundModel.id,
    provider: providerGroup.id,
    name: foundModel.name,
    reasoning_options: foundModel.reasoning_options,
    limit: foundModel.limit,
    cost: foundModel.cost,
  });
}

(async () => {
  const args = process.argv.slice(2);
  const provider = args[0]?.toLowerCase();
  const modelName = args[1]?.toLowerCase();

  if (!provider || !modelName) {
    console.log("Usage: bun run tests/model-dev.test.ts <provider> <modelName>");
    return;
  }

  findModel(provider, modelName);
})();
