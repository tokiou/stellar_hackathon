/**
 * Compatibility re-export for the repo .env loader.
 *
 * The canonical implementation now lives in ./config/loadRepoEnv.ts.
 * This file remains until all consumers (including tests) migrate to the
 * new path.
 */

export * from "./config/loadRepoEnv";
