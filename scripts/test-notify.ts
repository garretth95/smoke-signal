/**
 * Quick smoke test for the ntfy notification channel.
 * Run with: npx tsx scripts/test-notify.ts
 *
 * Reads NTFY_SERVER and NTFY_TOPIC from .dev.vars (or environment).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadDevVars(): Record<string, string> {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".dev.vars"), "utf8");
    return Object.fromEntries(
      raw
        .split("\n")
        .filter((l: string) => l.includes("=") && !l.startsWith("#"))
        .map((l: string) => {
          const idx = l.indexOf("=");
          return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
        })
    );
  } catch {
    return {};
  }
}

async function main() {
  const vars = loadDevVars();
  const server = (vars["NTFY_SERVER"] ?? process.env["NTFY_SERVER"] ?? "https://ntfy.sh").replace(
    /\/$/,
    ""
  );
  const topic = vars["NTFY_TOPIC"] ?? process.env["NTFY_TOPIC"];

  if (!topic) {
    console.error("NTFY_TOPIC not set in .dev.vars or environment");
    process.exit(1);
  }

  console.log(`Sending test notification to ${server}/${topic} ...`);

  const response = await fetch(`${server}/${topic}`, {
    method: "POST",
    headers: {
      Title: "smoke-signal test",
      Priority: "high",
      Tags: "tent,white_check_mark",
      Click: "https://www.recreation.gov/camping/campsites/99999",
    },
    body: "Site 042 (NORTH PINES) is open on Jul 4, 2026 — this is a test notification",
  });

  if (response.ok) {
    console.log("✓ Notification sent successfully");
  } else {
    console.error(`✗ Failed: ${response.status} ${response.statusText}`);
    console.error(await response.text());
  }
}

main().catch(console.error);
