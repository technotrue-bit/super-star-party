/** Vite loads this config in Node. The game tsconfig does not include @types/node. */
declare module "node:url" {
  export function fileURLToPath(url: URL | string): string;
}

declare module "node:child_process" {
  export function execSync(command: string, options?: { stdio?: unknown }): { toString(): string };
}

declare const process: { env: Record<string, string | undefined> };
