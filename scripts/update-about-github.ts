#!/usr/bin/env bun

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fetchGitHubStats, type GitHubStats } from "./github-stats";

const root = resolve(import.meta.dir, "..");
const jsonPath = resolve(root, "assets/about-my-github/about-my-github.json");

function replaceNumber(profile: string, label: string, value: number): string {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(".*?${escapedLabel}"\\s*:\\s*)\\d+`);

  if (!pattern.test(profile)) {
    throw new Error(`Could not find stat field: ${label}`);
  }

  return profile.replace(pattern, `$1${value}`);
}

export function updateProfile(profile: string, stats: GitHubStats): string {
  let updated = profile;

  updated = replaceNumber(updated, "total-stars-earned", stats.stars);
  updated = replaceNumber(updated, "total-commits(this year)", stats.commitsThisYear);
  updated = replaceNumber(updated, "total-PRs", stats.totalPRs);
  updated = replaceNumber(updated, "total-issues", stats.totalIssues);

  JSON.parse(updated);
  return updated;
}

async function main(login: string) {
  const token = process.env.GITHUB_PAT;

  if (!token) {
    throw new Error("Missing GITHUB_PAT. Export a GitHub token before running this script.");
  }

  const stats = await fetchGitHubStats(login, token);
  const profile = readFileSync(jsonPath, "utf8");
  const updated = updateProfile(profile, stats);

  console.log(
    `Stats: stars=${stats.stars}, commits=${stats.commitsThisYear}, prs=${stats.totalPRs}, issues=${stats.totalIssues}`,
  );

  if (updated === profile) {
    console.log("GitHub stats unchanged.");
    return;
  }

  writeFileSync(jsonPath, updated);
  console.log(`Updated ${jsonPath}`);
}

if (import.meta.main) {
  const login = process.argv[2];

  if (!login) {
    throw new Error("Missing GitHub login. Usage: update-about-github.ts <login>");
  }

  await main(login);
}
