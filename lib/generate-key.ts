import { customAlphabet } from "nanoid";

// URL-safe, human-readable characters (no 0/O, 1/l/I confusion)
const alphabet =
  "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz";
const generate = customAlphabet(alphabet, 32);

/**
 * Generate a new API key in format: rvm_<32 chars>
 * e.g. rvm_Kx7mN3pQwR8vT2sY4hJ6dG5fB9cA1eZ0
 */
export function generateApiKey(): string {
  return `rvm_${generate()}`;
}

/**
 * Extract the hint (last 4 chars) for display
 */
export function getKeyHint(apiKey: string): string {
  return apiKey.slice(-4);
}
