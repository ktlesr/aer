// Optional persistent queue for Node: `import { fileQueueStore } from "@ktlsr/collector-js/file-store"`.
// A separate entry point so browser/edge bundles of the SDK never pull in node:fs.
//
// The file holds what the queue holds: capture-filtered request bodies and their Idempotency-Keys
// (never the API key). Treat it like the data it contains: keep it on a private path.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { QueueState, QueueStore } from "./queue.js";

export function fileQueueStore(path: string): QueueStore {
  // Saves are serialised and each one is a snapshot taken at call time, written to a temp file and
  // renamed over the old one, so a crash mid-write leaves the previous complete state.
  let chain: Promise<void> = Promise.resolve();
  return {
    async load(): Promise<QueueState | null> {
      let text: string;
      try {
        text = await readFile(path, "utf8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw new Error("AER queue file could not be read");
      }
      let state: QueueState;
      try {
        state = JSON.parse(text) as QueueState;
      } catch {
        // Never silently start empty over a damaged file: that would be a quiet loss.
        throw new Error("AER queue file is not valid JSON; it was left untouched");
      }
      if (state?.version !== 1 || !Array.isArray(state.items) || !Array.isArray(state.failedRuns)) {
        throw new Error("AER queue file has an unknown format; it was left untouched");
      }
      return state;
    },
    save(state: QueueState): Promise<void> {
      const snapshot = JSON.stringify(state);
      const p = chain.then(async () => {
        await mkdir(dirname(path), { recursive: true });
        const tmp = `${path}.${process.pid}.tmp`;
        await writeFile(tmp, snapshot, { mode: 0o600 });
        await rename(tmp, path);
      });
      // This save's failure goes to its caller; the chain itself recovers so a later save (after
      // the disk/permission problem is fixed) is actually attempted.
      chain = p.catch(() => undefined);
      return p;
    },
  };
}
