import { createGlookoProvider } from "./glooko.js";

/** @type {ReadonlyArray<string>} */
export const SUPPORTED_CGM_SOURCES = Object.freeze(["glooko"]);

/**
 * @param {string} source
 * @param {Record<string, any>} config
 * @param {{ fetchImpl?: typeof fetch, now?: () => Date }=} deps
 * @returns {import('./types.js').CgmDataProvider}
 */
export function createCgmDataProvider(source, config, deps = {}) {
  const key = String(source || "").trim().toLowerCase();

  if (key === "glooko") {
    return createGlookoProvider(config, deps);
  }

  throw new Error(`Unsupported CGM source: ${source}`);
}
