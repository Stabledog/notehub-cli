// Bridge the gap between DOM's HeadersInit and Node's undici types.
// @types/node re-exports most fetch types globally but omits HeadersInit.
import type { HeadersInit } from 'undici-types';

declare global {
  type HeadersInit = import('undici-types').HeadersInit;
}
