/**
 * @typedef {Object} GlucoseReading
 * @property {Date} timestamp
 * @property {number} sgv
 * @property {string=} direction
 * @property {string=} device
 * @property {string} source
 */

/**
 * @typedef {Object} FetchReadingsOptions
 * @property {Date=} since
 * @property {number=} limit
 * @property {AbortSignal=} signal
 */

/**
 * @typedef {Object} CgmDataProvider
 * @property {(options?: FetchReadingsOptions) => Promise<GlucoseReading[]>} fetchReadings
 */

/**
 * @typedef {Object} GlookoProviderConfig
 * @property {string} email
 * @property {string} password
 * @property {string=} server
 * @property {"default"|"eu"|"development"|"production"=} env
 */

export {};
