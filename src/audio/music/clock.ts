/**
 * SUPER STAR PARTY — music step clock.
 *
 * Pure 16th-note timing for the sequencer: no Web Audio, no timers. The
 * caller passes the current audio time to plan(now) and gets back every
 * step whose start falls before now + lookahead, in order, each once.
 *
 * - Changes (tempo, transpose, lift) wait for the next main bar line that
 *   has not been planned yet. With `fill` and a theme fill, that bar plays
 *   as the fill at the old settings and the change lands one bar later.
 * - A pickup plays steps pickupStartStep..15 of one bar before main step 0.
 * - If plan() calls stall (hidden tab), the next step re-grids to
 *   now + 0.03 instead of replaying a backlog.
 * - With an anchor, each main bar line is moved onto the game clock's grid
 *   when it has drifted more than 5 ms. Steps inside a bar never move. Bars
 *   whose grid time is already behind now are skipped whole, and a bar line
 *   never starts before the step planned ahead of it. A bar line whose grid
 *   time is not a finite number (a NaN game time, a zero speed) ignores the
 *   anchor and keeps the free-running grid.
 * - A tempo or a length that is not a positive number throws: plan() would
 *   never reach its horizon.
 */

export interface PlannedStep {
  /** Position in the track (pickup: 0..15 of the pickup bar). Wraps when looping. */
  step: number;
  /** Running main-bar counter (0, 1, 2, ... never wrapped); -1 for the pickup bar. */
  bar: number;
  /** Unswung grid time of the step. */
  t: number;
  stepDur: number;
  /** Delay for odd steps: (swing - 0.5) * 2 * stepDur. */
  swingOffset: number;
  transpose: number;
  lift: boolean;
  fill: boolean;
  pickup: boolean;
}

export interface ClockChange {
  bpm?: number;
  transpose?: number;
  lift?: boolean;
  fill?: boolean;
}

export interface ClockAnchor {
  /** Game time of main bar 0's downbeat. */
  beat0: number;
  /** Bar length in game seconds. */
  barSec: number;
  /** Game seconds per audio second. */
  speed: number;
  gameNow: () => number;
  audioNow: () => number;
}

export interface StepClockOpts {
  bpm: number;
  swing: number;
  totalSteps: number;
  loop: boolean;
  t0: number;
  transpose?: number;
  lift?: boolean;
  hasFill?: boolean;
  pickupStartStep?: number;
}

const STEPS_PER_BAR = 16;
const RESYNC_GAP = 0.5;
const RESYNC_LEAD = 0.03;
const ANCHOR_TOLERANCE = 0.005;
const BAR_HISTORY = 8;

/** Throws on a tempo that would stall plan(): zero, negative, NaN or infinite. */
function checkBpm(bpm: number): void {
  if (!(Number.isFinite(bpm) && bpm > 0)) throw new RangeError(`StepClock: bpm must be a positive number, not ${bpm}`);
}

export class StepClock {
  private readonly swing: number;
  private readonly totalSteps: number;
  private readonly loop: boolean;
  private readonly hasFill: boolean;
  private _bpm: number;
  private _transpose: number;
  private _lift: boolean;
  private _ended = false;
  /** The next step to plan: its position, bar, start time and whether it is in the pickup. */
  private step: number;
  private bar: number;
  private nextT: number;
  private inPickup: boolean;
  private pending: ClockChange | null = null;
  /** The current bar is a fill; `pending` applies at the next bar line. */
  private filling = false;
  /** Start time of the last step returned. */
  private prevT = -Infinity;
  private anchor: ClockAnchor | null = null;
  private lastNow: number | null = null;
  private bars: number[] = [];

  constructor(o: StepClockOpts) {
    checkBpm(o.bpm);
    if (!(Number.isInteger(o.totalSteps) && o.totalSteps > 0)) {
      throw new RangeError(`StepClock: totalSteps must be a positive whole number, not ${o.totalSteps}`);
    }
    this.swing = o.swing;
    this.totalSteps = o.totalSteps;
    this.loop = o.loop;
    this.hasFill = o.hasFill ?? false;
    this._bpm = o.bpm;
    this._transpose = o.transpose ?? 0;
    this._lift = o.lift ?? false;
    this.nextT = o.t0;
    const s = o.pickupStartStep;
    if (s !== undefined && s < STEPS_PER_BAR) {
      this.inPickup = true;
      this.step = s;
      this.bar = -1;
    } else {
      this.inPickup = false;
      this.step = 0;
      this.bar = 0;
    }
  }

  /**
   * True once a non-looping track's last step has been planned. That step may not have sounded
   * yet: the Sequencer ends the track (onEnded) after it and its notes have rung out.
   */
  get ended(): boolean {
    return this._ended;
  }

  get bpm(): number {
    return this._bpm;
  }

  get transpose(): number {
    return this._transpose;
  }

  get lift(): boolean {
    return this._lift;
  }

  /** Queue a change for the next unplanned bar line. Repeated calls merge; later fields win. */
  queueChange(c: ClockChange): void {
    if (c.bpm !== undefined) checkBpm(c.bpm);
    const p = this.pending ?? {};
    this.pending = {
      bpm: c.bpm ?? p.bpm,
      transpose: c.transpose ?? p.transpose,
      lift: c.lift ?? p.lift,
      fill: p.fill || c.fill,
    };
  }

  setAnchor(a: ClockAnchor | null): void {
    this.anchor = a;
  }

  plan(now: number, lookahead = 0.12): PlannedStep[] {
    const out: PlannedStep[] = [];
    // Hidden tab: the caller's timer was throttled. Skip the backlog rather
    // than replaying it (only ever moves the next step later).
    if (this.lastNow !== null && now - this.lastNow > RESYNC_GAP) {
      this.nextT = Math.max(this.nextT, now + RESYNC_LEAD);
    }
    this.lastNow = now;
    const horizon = now + lookahead;
    while (!this._ended) {
      const barLine = !this.inPickup && this.step % STEPS_PER_BAR === 0;
      const t = barLine && this.anchor ? this.anchoredTime(this.anchor, now) : this.nextT;
      if (this._ended || t >= horizon) break; // ended: the anchor skipped past the last bar
      this.nextT = t;
      if (barLine) this.enterBar(t);
      const stepDur = 60 / this._bpm / 4;
      out.push({
        step: this.step,
        bar: this.bar,
        t,
        stepDur,
        swingOffset: (this.swing - 0.5) * 2 * stepDur,
        transpose: this._transpose,
        lift: this._lift,
        fill: this.filling,
        pickup: this.inPickup,
      });
      this.prevT = t;
      this.nextT += stepDur;
      this.advance();
    }
    return out;
  }

  /** Planned times of the last 8 main bar lines, oldest first. */
  barTimes(): number[] {
    return this.bars.slice();
  }

  /**
   * Where the next main bar line starts: on the anchor's grid if it has
   * drifted. Bars already behind now are skipped whole; the result is
   * never before the previous step. Ends a non-looping track that runs out.
   * A target that is not a finite time leaves the bar line where the free-running grid has it.
   */
  private anchoredTime(a: ClockAnchor, now: number): number {
    const target = () => a.audioNow() + (a.beat0 + this.bar * a.barSec - a.gameNow()) / a.speed;
    let t = target();
    while (Number.isFinite(t) && t < now) {
      if (!this.skipBar()) return t;
      t = target();
    }
    if (!Number.isFinite(t)) return this.nextT;
    if (Math.abs(t - this.nextT) <= ANCHOR_TOLERANCE) t = this.nextT;
    return Math.max(t, this.prevT);
  }

  /** Skip the bar at the current bar line. False when a non-looping track runs out. */
  private skipBar(): boolean {
    // A fill not yet started would have played in this bar: drop it, keep the change.
    if (this.pending && !this.filling) this.pending = { ...this.pending, fill: false };
    this.step += STEPS_PER_BAR;
    if (this.step >= this.totalSteps) {
      if (!this.loop) {
        this._ended = true;
        return false;
      }
      this.step %= this.totalSteps;
    }
    this.bar += 1;
    return true;
  }

  /** A main bar line is being planned: start or finish a fill, apply the pending change. */
  private enterBar(t: number): void {
    const p = this.pending;
    if (p) {
      if (!this.filling && p.fill && this.hasFill) {
        this.filling = true;
      } else {
        if (p.bpm !== undefined) this._bpm = p.bpm;
        if (p.transpose !== undefined) this._transpose = p.transpose;
        if (p.lift !== undefined) this._lift = p.lift;
        this.pending = null;
        this.filling = false;
      }
    }
    this.bars.push(t);
    if (this.bars.length > BAR_HISTORY) this.bars.shift();
  }

  private advance(): void {
    this.step += 1;
    if (this.inPickup) {
      if (this.step >= STEPS_PER_BAR) {
        this.inPickup = false;
        this.step = 0;
        this.bar = 0;
      }
      return;
    }
    if (this.step >= this.totalSteps) {
      if (!this.loop) {
        this._ended = true;
        return;
      }
      this.step = 0;
    }
    if (this.step % STEPS_PER_BAR === 0) this.bar += 1;
  }
}
