/// <reference types="vite/client" />

declare module 'node:crypto' {
  type Hash = { update(data: string | Uint8Array): Hash; digest(encoding: 'hex'): string };
  export function createHash(algorithm: string): Hash;
}

declare module 'node:fs' {
  export function readFileSync(path: string | URL): Uint8Array;
  export function readFileSync(path: string | URL, encoding: 'utf8'): string;
}
