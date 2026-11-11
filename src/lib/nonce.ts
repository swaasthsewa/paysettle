import { headers } from "next/headers";
import { NONCE_HEADER } from "./csp-scripts";

/** This request's script nonce (lib/csp-scripts.ts), for an inline start-up script; none when the rule is off. */
export async function scriptNonce(): Promise<string | undefined> {
  return (await headers()).get(NONCE_HEADER) || undefined;
}
