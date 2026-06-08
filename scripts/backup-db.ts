#!/usr/bin/env bun

import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { loadConfig } from "../src/shared/config";

type CliArgs = {
  output: string | null;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    output: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--output" || arg === "-o") {
      const next = argv[index + 1];
      if (!next) {
        throw new Error("--output requires a path");
      }
      args.output = next;
      index += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printHelpAndExit();
    }
  }

  return args;
}

function printHelpAndExit(): never {
  console.log(`
Usage:
  bun run backup:db [options]

Options:
  -o, --output <path>   Write the backup to this path
  -h, --help            Show this help

Examples:
  bun run backup:db
  bun run backup:db -- --output /data/backups/rokum.sqlite
`.trim());
  process.exit(0);
}

function sqliteString(value: string) {
  return value.replaceAll("'", "''");
}

function defaultBackupPath(databasePath: string) {
  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  return join(dirname(databasePath), "backups", `rokum-${stamp}.sqlite`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  if (!existsSync(config.databasePath)) {
    throw new Error(`Database not found: ${config.databasePath}`);
  }

  const outputPath = resolve(args.output ?? defaultBackupPath(config.databasePath));
  mkdirSync(dirname(outputPath), { recursive: true });

  if (existsSync(outputPath)) {
    throw new Error(`Backup already exists: ${outputPath}`);
  }

  const database = new Database(config.databasePath);
  try {
    database.exec(`VACUUM INTO '${sqliteString(outputPath)}';`);
  } finally {
    database.close();
  }

  console.log(`Database backup written to ${outputPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
