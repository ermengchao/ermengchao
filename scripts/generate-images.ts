#!/usr/bin/env bun

import { readdir } from "node:fs/promises";
import { dirname, extname, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assetsDir = join(root, "assets");
const scaleFactor = 5;

async function findJsonFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });

  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        return findJsonFiles(fullPath);
      }

      if (entry.isFile() && extname(entry.name) === ".json") {
        return [fullPath];
      }

      return [];
    }),
  );

  return files.flat();
}

async function render(
  input: string,
  output: string,
  config: string,
): Promise<void> {
  const title = `${parse(input).name}.json`;

  const proc = Bun.spawn(
    [
      "codesnap",
      "-f",
      input,
      "-o",
      output,
      "--mac-window-bar=false",
      `--title=${title}`,
      "--shadow-color",
      "#00000000",
      "--scale-factor",
      String(scaleFactor),
      "--config",
      config,
    ],
    {
      stdout: "inherit",
      stderr: "inherit",
    },
  );

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(`codesnap failed for ${input}`);
  }
}

const xdgConfigHome = process.env.XDG_CONFIG_HOME;

if (!xdgConfigHome) {
  throw new Error("XDG_CONFIG_HOME is not set");
}

const jsonFiles = await findJsonFiles(assetsDir);

for (const file of jsonFiles) {
  const outputDir = dirname(file);

  await render(
    file,
    join(outputDir, "light.svg"),
    join(xdgConfigHome, "codesnap", "catppuccin-latte.json"),
  );

  await render(
    file,
    join(outputDir, "dark.svg"),
    join(xdgConfigHome, "codesnap", "catppuccin-mocha.json"),
  );
}
