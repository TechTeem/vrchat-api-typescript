import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const specUrl =
  "https://github.com/vrchatapi/specification/releases/latest/download/openapi.json";
const outputPath = resolve(process.cwd(), "openapi.json");
const metaPath = resolve(process.cwd(), "src/spec-meta.ts");

const response = await fetch(specUrl, {
  headers: {
    "user-agent": "vrchat-api-typescript-generator",
  },
});

if (!response.ok) {
  throw new Error(
    `Failed to download VRChat OpenAPI spec: ${response.status} ${response.statusText}`,
  );
}

const specText = await response.text();
await writeFile(outputPath, specText, "utf8");

const spec = JSON.parse(specText);
const specVersion = String(spec.info?.version || "unknown");
const generatedAt = new Date().toISOString();

await mkdir(dirname(metaPath), { recursive: true });
await writeFile(
  metaPath,
  [
    `export const VRCHAT_SPEC_URL = ${JSON.stringify(specUrl)};`,
    `export const VRCHAT_SPEC_VERSION = ${JSON.stringify(specVersion)};`,
    `export const VRCHAT_SPEC_GENERATED_AT = ${JSON.stringify(generatedAt)};`,
  ].join("\n") + "\n",
  "utf8",
);

console.log(`Downloaded VRChat OpenAPI spec ${specVersion}`);
