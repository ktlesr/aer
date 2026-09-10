import { describe, expect, it } from "vitest";
import {
  buildFunnel,
  countProjectsBy,
  parseInternalEmails,
  type ProjectActivity,
} from "@/lib/ops/adoption";

const now = new Date("2026-09-10T12:00:00.000Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);

const none: ProjectActivity = {
  firstKeyAt: null,
  firstRunAt: null,
  firstEventAt: null,
  lastEventAt: null,
};

describe("buildFunnel", () => {
  const projects: ProjectActivity[] = [
    // signed up, never created a key
    none,
    // key, but never started a run
    { ...none, firstKeyAt: daysAgo(20) },
    // run created, no event ever arrived
    { ...none, firstKeyAt: daysAgo(20), firstRunAt: daysAgo(19) },
    // brand new: first event 2 days ago — too young to judge retention
    { firstKeyAt: daysAgo(3), firstRunAt: daysAgo(2), firstEventAt: daysAgo(2), lastEventAt: daysAgo(1) },
    // tried once 40 days ago, gone after 5 days — eligible for both cohorts, retained in neither
    { firstKeyAt: daysAgo(41), firstRunAt: daysAgo(40), firstEventAt: daysAgo(40), lastEventAt: daysAgo(35) },
    // real user: started 40 days ago, still sending today
    { firstKeyAt: daysAgo(41), firstRunAt: daysAgo(40), firstEventAt: daysAgo(40), lastEventAt: daysAgo(0) },
    // started 10 days ago, still active — eligible for 7d only
    { firstKeyAt: daysAgo(10), firstRunAt: daysAgo(10), firstEventAt: daysAgo(10), lastEventAt: daysAgo(1) },
  ];

  const f = buildFunnel(projects, now);

  it("counts each funnel step", () => {
    expect(f.signedUp).toBe(7);
    expect(f.keyCreated).toBe(6);
    expect(f.firstRun).toBe(5);
    expect(f.firstEvent).toBe(4);
  });

  it("separates recent activity from retention", () => {
    expect(f.active7d).toBe(3);
    expect(f.active30d).toBe(3);
    expect(f.newThisWeek).toBe(1);
  });

  it("only counts projects old enough to have churned as retention-eligible", () => {
    expect(f.retained7d).toEqual({ retained: 2, eligible: 3 });
    expect(f.retained30d).toEqual({ retained: 1, eligible: 2 });
  });

  it("treats the retention boundary as inclusive", () => {
    const edge: ProjectActivity = {
      ...none,
      firstEventAt: daysAgo(7),
      lastEventAt: daysAgo(0),
    };
    expect(buildFunnel([edge], now).retained7d).toEqual({ retained: 1, eligible: 1 });
  });
});

describe("countProjectsBy", () => {
  it("counts distinct projects per label, most-used first", () => {
    const rows = [
      { projectId: "a", v: "0.2.0" },
      { projectId: "a", v: "0.2.0" }, // same project twice — still one
      { projectId: "b", v: "0.2.0" },
      { projectId: "a", v: "0.1.0" }, // a project on two versions counts under both
    ];
    expect(countProjectsBy(rows, (r) => r.v)).toEqual([
      ["0.2.0", 2],
      ["0.1.0", 1],
    ]);
  });
});

describe("parseInternalEmails", () => {
  it("trims, lowercases and drops empties", () => {
    expect([...parseInternalEmails(" Me@X.com, ,ops@x.com ")]).toEqual(["me@x.com", "ops@x.com"]);
    expect(parseInternalEmails(undefined).size).toBe(0);
  });
});
