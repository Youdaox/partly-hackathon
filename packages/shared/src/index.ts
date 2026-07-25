/**
 * @partli/shared — root entrypoint.
 *
 * Safe to import from anywhere, including React Native and the browser: nothing
 * here touches `node:fs`.
 *
 * The dataset loaders that used to live behind `@partli/shared/dataset` are gone.
 * Catalogue parsing, tagging and pricing now happen server-side in the Python
 * backend, which is the only thing that should ever hold a 2.9 MB assemblies.json.
 */

export * from './types.js';
export * from './matching.js';
export * from './format.js';
