export { handle, handleSlug } from './Handle.js';
export type { EntityHandle } from './Handle.js';

export { EntitySchema } from './EntitySchema.js';
export type { PropGroupDef } from './EntitySchema.js';

export { groupOf } from './EntityRecord.js';
export type { EntityRecord } from './EntityRecord.js';

export { EntityValidationError } from './EntityValidationError.js';

export type { FilterOp } from './FilterOp.js';

export type {
    CollectionViewOpts,
    CollectionViewItemRecord,
    CollectionViewRecord,
} from './CollectionViewTypes.js';

export {
    RDF_TYPE, TERN_PROP_GROUP, TERN_HANDLE,
    XSD_STRING, XSD_BOOLEAN, XSD_INTEGER, XSD_DECIMAL, XSD_DATETIME,
    TERN_VIEW_NS,
    TERN_COLLECTION_VIEW, TERN_COLLECTION_VIEW_ITEM,
    TERN_CV_SOURCE, TERN_CV_PROP, TERN_CV_SORT_PROP, TERN_CV_SORT_DIR, TERN_CV_ITEM,
    TERN_CVI_VIEW, TERN_CVI_REF, TERN_CVI_POS,
} from './constants.js';

export {
    newId, entityIri, localName, pgIri, idFromIri,
    toLiteral, fromLiteral, invertPropertyMap, propertyMapFor,
} from './util.js';
