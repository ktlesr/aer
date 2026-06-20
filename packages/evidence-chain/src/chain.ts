import { genesisHash, hashEvent } from "./hash";
import type { ChainLink, EventCore } from "./types";

/** Build the append-only chain for a run: genesis → … → head, in seq order. */
export function computeChain(runId: string, cores: EventCore[]): ChainLink[] {
  const ordered = [...cores].sort((a, b) => a.seq - b.seq);
  const links: ChainLink[] = [];
  let prev = genesisHash(runId);
  for (const core of ordered) {
    const hash = hashEvent(prev, core);
    links.push({ ...core, prevHash: prev, hash });
    prev = hash;
  }
  return links;
}
