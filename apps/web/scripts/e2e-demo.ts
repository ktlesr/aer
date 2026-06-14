// End-to-end verification of the whole AER pipeline against a RUNNING web app (GO_LIVE G7).
//
//   1. ensure a valid API key exists (mint a fresh one)
//   2. run the demo agent against the live API
//   3. poll (via export) until the run is complete
//   4. trigger a JSON export and download the packet
//   5. assert: expected events, >=2 redaction findings (email + phone), a content hash, NO raw PII
//   6. print PASS / FAIL
//
//   pnpm e2e:demo
import "dotenv/config";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { issueKey } from "./create-key";

const BASE_URL =
  process.env.AER_API_BASE_URL ?? process.env.AER_BASE_URL ?? "http://localhost:3000";

// Raw PII the live demo agent sends — the packet must contain NONE of these.
const RAW_PII = ["jane.doe@example.com", "+1 415 555 0142"];
const EXPECTED_EVENTS = 9;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function fail(message: string): never {
  console.error(`\n❌ E2E FAIL — ${message}`);
  process.exit(1);
}

/** Spawn the real demo agent with our minted key; resolve its completed run id from stdout. */
function runDemoAgent(apiKey: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["--filter", "demo-agent", "start"], {
      cwd: repoRoot,
      env: { ...process.env, AER_API_BASE_URL: BASE_URL, AER_API_KEY: apiKey },
      shell: process.platform === "win32",
    });

    let out = "";
    child.stdout.on("data", (d) => {
      out += String(d);
      process.stdout.write(d);
    });
    child.stderr.on("data", (d) => process.stderr.write(d));

    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`demo-agent exited with code ${code}`));
      const m = /run completed:\s*(\S+)/.exec(out);
      if (!m) return reject(new Error("could not parse run id from demo-agent output"));
      resolve(m[1]);
    });
  });
}

async function api(method: string, pathname: string, apiKey: string): Promise<Response> {
  return fetch(`${BASE_URL}${pathname}`, {
    method,
    headers: { authorization: `Bearer ${apiKey}` },
  });
}

async function main(): Promise<void> {
  console.log(`E2E demo against ${BASE_URL}\n`);

  // Pre-flight: is the web app reachable? (an unauthenticated POST should yield 401, not a network error)
  try {
    await fetch(`${BASE_URL}/api/v1/runs`, { method: "POST" });
  } catch {
    fail(`web app not reachable at ${BASE_URL} — start it with \`pnpm dev\` first`);
  }

  // 1. Ensure a key exists.
  const { apiKey } = await issueKey({ keyName: "e2e key" });
  console.log("✓ minted a fresh API key\n");

  // 2. Run the demo agent.
  const runId = await runDemoAgent(apiKey);
  console.log(`\n✓ demo agent recorded run ${runId}\n`);

  // 3 + 4. Poll via export until the run reports complete, then download the packet.
  let packet: Record<string, unknown> | null = null;
  let downloadPath = "";
  for (let attempt = 0; attempt < 10; attempt++) {
    const res = await api("POST", `/api/v1/runs/${runId}/exports?type=json`, apiKey);
    if (!res.ok) fail(`export request failed with HTTP ${res.status}`);
    const body = (await res.json()) as { export: { downloadPath: string } };
    downloadPath = body.export.downloadPath;

    const dl = await api("GET", downloadPath, apiKey);
    if (!dl.ok) fail(`download failed with HTTP ${dl.status}`);
    const p = (await dl.json()) as Record<string, unknown>;
    const status = (p.run as { status?: string })?.status;
    if (status === "completed") {
      packet = p;
      break;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  if (!packet) fail("run never reached status=completed");
  console.log(`✓ downloaded audit packet (${downloadPath})\n`);

  // 5. Assertions.
  const run = packet.run as { eventCount: number; status: string };
  const events = packet.events as unknown[];
  const findings = packet.redaction_findings as Array<{ findingType: string; originalHash: string }>;
  const contentHash = (packet.export as { content_hash?: string })?.content_hash ?? "";
  const raw = JSON.stringify(packet);

  const checks: Array<[string, boolean]> = [
    [`run status is completed`, run.status === "completed"],
    [`packet has ${EXPECTED_EVENTS} events`, events.length === EXPECTED_EVENTS],
    [`run.eventCount = ${EXPECTED_EVENTS}`, run.eventCount === EXPECTED_EVENTS],
    [`>= 2 redaction findings (got ${findings.length})`, findings.length >= 2],
    [`an email finding is present`, findings.some((f) => f.findingType === "email")],
    [`a phone finding is present`, findings.some((f) => f.findingType === "phone")],
    [`findings store only sha256 hashes`, findings.every((f) => /^sha256:[0-9a-f]{64}$/.test(f.originalHash))],
    [`export carries a sha256 content_hash`, /^sha256:[0-9a-f]{64}$/.test(contentHash)],
    [`packet contains NO raw PII`, RAW_PII.every((pii) => !raw.includes(pii))],
    [`packet does NOT contain the API key`, !raw.includes(apiKey)],
  ];

  console.log("Assertions:");
  let allOk = true;
  for (const [label, ok] of checks) {
    console.log(`  ${ok ? "✓" : "✗"} ${label}`);
    if (!ok) allOk = false;
  }

  if (!allOk) fail("one or more assertions failed");
  console.log("\n✅ E2E PASS — full pipeline works end to end.");
}

main().catch((err: unknown) => {
  fail(err instanceof Error ? err.message : String(err));
});
