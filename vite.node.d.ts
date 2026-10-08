/** Vite loads this config in Node. The game tsconfig does not include @types/node. */
declare module "node:url" {
  export function fileURLToPath(url: URL | string): string;
}
