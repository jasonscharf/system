export { handle, handleSlug } from './Handle.js';
export type { EntityHandle } from './Handle.js';

export { EntitySchema } from './EntitySchema.js';
export type { PropGroupDef } from './EntitySchema.js';

export { EntityStore, groupOf } from './EntityStore.js';
export type { EntityRecord } from './EntityStore.js';

export { CollectionViewStore } from './CollectionView.js';
export type { CollectionViewOpts, CollectionViewRecord, CollectionViewItemRecord } from './CollectionView.js';

export { EntityQuery, entities } from './EntityQuery.js';

export { EntityValidationError } from './EntityValidationError.js';

export {
    RDF_TYPE, TERN_PROP_GROUP, TERN_HANDLE,
    XSD_STRING, XSD_BOOLEAN, XSD_INTEGER, XSD_DECIMAL, XSD_DATETIME,
} from './constants.js';
