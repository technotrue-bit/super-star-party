import { palette } from '../config/palette';

export interface CharacterKind {
  key: string;
  name: string;
  color: string;
  dice: number[];
  tagline: string;
}

/** Seats in a match. The roster can be bigger: players pick from all of it. */
export const MATCH_SEATS = 4;

export const roster: CharacterKind[] = [
  { key: 'pip', name: 'Pip', color: palette.heroPip, dice: [1, 2, 3, 4, 5, 6], tagline: 'The star of the show!' },
  { key: 'bounce', name: 'Bounce', color: palette.heroBounce, dice: [1, 1, 2, 3, 6, 6], tagline: 'Bouncy, bold, unstoppable!' },
  { key: 'glimmer', name: 'Glimmer', color: palette.heroGlimmer, dice: [2, 2, 3, 4, 5, 5], tagline: 'A sneaky little spark!' },
  { key: 'tusk', name: 'Tusk', color: palette.heroTusk, dice: [3, 3, 4, 4, 5, 5], tagline: 'Slow and steady wins!' },
  { key: 'mallow', name: 'Mallow', color: palette.heroMallow, dice: [1, 3, 3, 4, 4, 6], tagline: 'Big heart, bigger splash!' },
  { key: 'rumble', name: 'Rumble', color: palette.heroRumble, dice: [1, 1, 3, 4, 6, 6], tagline: 'A tiny dino with a mighty roar!' },
  { key: 'jack', name: 'Jack', color: palette.heroJack, dice: [2, 3, 3, 3, 4, 6], tagline: 'Floats along, lights the way!' },
  { key: 'wisp', name: 'Wisp', color: palette.heroWisp, dice: [1, 1, 1, 6, 6, 6], tagline: 'A little spooky, a lot cute!' },
  { key: 'rattle', name: 'Rattle', color: palette.heroRattle, dice: [1, 2, 2, 5, 5, 6], tagline: 'Bad to the bone, great at parties!' },
];

export function characterByKey(key: string): CharacterKind {
  const found = roster.find((c) => c.key === key);
  if (!found) {
    throw new Error(`Unknown character key: ${key}`);
  }
  return found;
}

export function characterDice(key: string): number[] {
  return [...characterByKey(key).dice];
}

export function characterColor(key: string): string {
  return characterByKey(key).color;
}
