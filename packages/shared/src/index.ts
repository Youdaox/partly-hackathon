/**
 * @partli/shared — root entrypoint.
 *
 * Safe to import from anywhere, including React Native and the browser: nothing here
 * touches `node:fs`. The dataset loaders live behind `@partli/shared/dataset`
 * so a mobile bundle can never accidentally pull the filesystem in.
 */

export * from './types.js';
export * from './pricing.js';
export * from './matching.js';
