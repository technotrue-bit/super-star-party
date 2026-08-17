import { palette } from '../config/palette';

export interface CharacterKind {
  key: string;
  name: string;
  color: string;
  dice: number[];
  tagline: string;
}

export const roster: CharacterKind[] = [
  { key: 'pip', name: 'Pip', color: palette.heroPip, dice: [1, 2, 3, 4, 5, 6], tagline: 'The star of the show!' },
  { key: 'bounce', name: 'Bounce', color: palette.heroBounce, dice: [1, 1, 2, 3, 6, 6], tagline: 'Bouncy, bold, unstoppable!' },
  { key: 'glimmer', name: 'Glimmer', color: palette.heroGlimmer, dice: [2, 2, 3, 4, 5, 5], tagline: 'A sneaky little spark!' },
  { key: 'tusk', name: 'Tusk', color: palette.heroTusk, dice: [3, 3, 4, 4, 5, 5], tagline: 'Slow and steady wins!' },
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
