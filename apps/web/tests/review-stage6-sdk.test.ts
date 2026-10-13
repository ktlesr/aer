// Independent round 2: no network. Fake clock makes shutdown's outstanding timer observable.
import { expect, it, vi } from "vitest";
import { AgentEvidenceRecorder } from "../../../packages/collector-js/src/index";

it("security: shutdown cancels an approval polling wait", async () => {
  const recorder = new AgentEvidenceRecorder({
    baseUrl: "http://localhost", apiKey: "aer_test_synthetic_review_poll", maxRetries: 0,
    fetchImpl: async url => new URL(String(url)).pathname === "/api/v1/runs"
      ? Response.json({ run: { id: "synthetic-review-run" } })
      : Response.json({ approval: { id: "synthetic-review-approval", status: "pending" } }),
  });
  const run = await recorder.startRun({ agentName: "review" });
  vi.useFakeTimers();
  try {
    const waiting = run.waitForApproval("synthetic-review-approval", { pollMs: 60_000, timeoutMs: 300_000 });
    const outcome = waiting.then(() => "resolved", () => "rejected");
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    await recorder.shutdown();
    const remainingTimers = vi.getTimerCount();
    await vi.runAllTimersAsync();
    expect(await outcome).toBe("rejected");
    expect(remainingTimers).toBe(0);
  } finally {
    vi.useRealTimers();
    await recorder.shutdown();
  }
});
