import { describe, expect, it } from "vitest";
import { SeqTracker } from "./seqTracker";

describe("SeqTracker", () => {
  it("advances through contiguous seqs", () => {
    const t = new SeqTracker(4);
    expect(t.observe(5)).toBe(false);
    expect(t.observe(6)).toBe(false);
    expect(t.value).toBe(6);
  });
  it("detects a gap and closes it when the missing seq arrives (out-of-order delivery)", () => {
    const t = new SeqTracker(10);
    expect(t.observe(12)).toBe(true);
    expect(t.value).toBe(10);
    expect(t.observe(11)).toBe(false);
    expect(t.value).toBe(12);
  });
  it("ignores old and duplicate seqs", () => {
    const t = new SeqTracker(10);
    expect(t.observe(3)).toBe(false);
    expect(t.observe(11)).toBe(false);
    expect(t.observe(11)).toBe(false);
    expect(t.value).toBe(11);
  });
  it("knows when the server is ahead", () => {
    const t = new SeqTracker(10);
    expect(t.behind(10)).toBe(false);
    expect(t.behind(13)).toBe(true);
  });
});
