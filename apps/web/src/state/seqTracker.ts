/**
 * Tracks which per-room sequence numbers we've seen.
 * `cursor` = every seq <= cursor is accounted for (loaded, or deliberately covered by history paging).
 * Seqs above the cursor wait in `ahead` until the gap below them is filled.
 */
export class SeqTracker {
  private cursor: number;
  private ahead = new Set<number>();

  constructor(cursor = 0) {
    this.cursor = cursor;
  }

  get value() {
    return this.cursor;
  }

  /** Returns true if there is now a gap (a seq above cursor+1 seen while cursor+1 is missing). */
  observe(seq: number): boolean {
    if (seq <= this.cursor) return this.hasGap();
    this.ahead.add(seq);
    while (this.ahead.has(this.cursor + 1)) {
      this.ahead.delete(this.cursor + 1);
      this.cursor++;
    }
    return this.hasGap();
  }

  hasGap() {
    return this.ahead.size > 0;
  }

  /** Server says the room is at `lastSeq`; anything between cursor and it is missing. */
  behind(lastSeq: number) {
    return lastSeq > this.cursor;
  }
}
