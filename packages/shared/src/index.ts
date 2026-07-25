/**
 * @first-look/shared — root entrypoint.
 *
 * Safe to import from anywhere, including React Native and the browser: nothing here
 * touches `node:fs`. The dataset loaders live behind `@first-look/shared/dataset`
 * so a mobile bundle can never accidentally pull the filesystem in.
 */

export * from './types.js';
export * from './pricing.js';
