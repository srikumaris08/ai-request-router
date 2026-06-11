/**
 * @file index.js  (src/models)
 * @description Barrel file — import every model once and re-export.
 *
 * Usage anywhere in the app:
 *   import { User, CustomerRequest, AIClassification } from '../models/index.js';
 */

export { default as User }               from './User.model.js';
export { default as CustomerRequest }    from './CustomerRequest.model.js';
export { default as AIClassification }   from './AIClassification.model.js';
export { default as RequestEvent }       from './RequestEvent.model.js';
export { default as InternalNote }       from './InternalNote.model.js';

// Named constant exports (enums) — useful in services and validators
export { USER_ROLES }                    from './User.model.js';
export { REQUEST_STATUS, SOURCE_CHANNELS, PRIORITY_LEVELS } from './CustomerRequest.model.js';
export { AI_PROVIDERS, AI_CATEGORIES, AI_PRIORITIES }       from './AIClassification.model.js';
export { EVENT_TYPES, ACTOR_TYPES }      from './RequestEvent.model.js';
