import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RunLineage, SourcedEvidence } from "./sourced-evidence";
import { sourcedView } from "@/lib/audit/sourced";

describe("SourcedEvidence", () => {
  it("labels inferred context, keeps candidates apart from support, and shows gaps as not recorded", () => {
    const view = sourcedView({
      profile: "sourced_assistant",
      version: 1,
      context: { used: [{ key: "il", value: "Muğla", origin: "inferred" }], missing: ["yatirim_tutari"] },
      retrievedSources: [{ id: "cand-1", score: 0.42, scoreMethod: "bm25" }],
      generation: { model: "m-1" },
    })!;
    const html = renderToStaticMarkup(<SourcedEvidence seq={2} sourced={view} />);
    expect(html).toContain("inferred — not confirmed");
    expect(html).toContain("missing_context: yatirim_tutari");
    expect(html).toContain("Retrieved candidates");
    expect(html).toContain("not probabilities");
    expect(html).toContain("score 0.42 (bm25)");
    // cited list empty → not recorded, never the retrieved candidate
    const cited = html.slice(html.indexOf("Cited as support"), html.indexOf("Retrieved candidates"));
    expect(cited).toContain("not recorded");
    expect(cited).not.toContain("cand-1");
    expect(html.match(/not recorded/g)!.length).toBeGreaterThanOrEqual(5);
  });

  it("a missing parent is shown as missing_context, not as a link", () => {
    const html = renderToStaticMarkup(
      <RunLineage links={{ conversationRef: "c1", turnRef: null, parentRun: { id: "run_x", status: "missing_context", agentName: null } }} />,
    );
    expect(html).toContain("missing_context · run_x");
    expect(html).not.toContain('href="/runs/run_x"');
  });
});
