/**
 * CRANK COASTER — where things stand (presentation only; the rules know nothing of this).
 *
 * Four lift hills side by side, one per seat, each a straight steep climb from a foot at
 * BASE to a summit at TOP (y up, z toward the camera). A point `u` (0..1) up the hill is
 * `trackPoint(u)`. The track frame is the hill's own: local +Y runs up the track, local +Z
 * is the track's normal (up and a little toward the camera), so a thing built along Y in
 * a group rotated by TRACK_TILT about X lies on the hill.
 */
export const LANES = 4;
export const LANE_GAP = 2.6;

export const laneX = (i: number): number => (i - (LANES - 1) / 2) * LANE_GAP;

/** Foot and summit of the track centre line. */
export const BASE = { y: 1.9, z: 2.0 } as const;
export const TOP = { y: 14.0, z: -4.4 } as const;

export const RISE = TOP.y - BASE.y;
export const RUN = BASE.z - TOP.z;
export const HILL_LEN = Math.hypot(RISE, RUN);
/** Elevation of the track above the floor (rad). */
export const HILL_ANGLE = Math.atan2(RISE, RUN);
/** Rotation about X that lays a Y-long object along the track. */
export const TRACK_TILT = HILL_ANGLE - Math.PI / 2;

/** Rails stand this far either side of the centre line. */
export const RAIL_X = 0.5;

/** Height and depth of the track centre line at distance `s` (m) up the track. */
export function trackAt(s: number): { y: number; z: number } {
  return { y: BASE.y + Math.sin(HILL_ANGLE) * s, z: BASE.z - Math.cos(HILL_ANGLE) * s };
}

/** The same by climb fraction 0..1. */
export function trackPoint(u: number): { y: number; z: number } {
  return trackAt(Math.min(1, Math.max(0, u)) * HILL_LEN);
}

/** The winch (crank wheel) stands in front of the foot. */
export const WINCH = { y: 1.25, z: 4.3 } as const;
