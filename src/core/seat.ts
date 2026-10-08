/**
 * Who drives a seat. The solo path is one local human and three CPUs.
 * Remote is a stub until a session can supply that seat's choices.
 */
export type SeatController = "local" | "cpu" | "remote";

/** Seat 0 is the local human. Every other seat is a CPU. */
export function defaultSeatController(index: number): SeatController {
  return index === 0 ? "local" : "cpu";
}
