export type {
    CollectionViewItemRecord,
    CollectionViewOpts,
    CollectionViewRecord,
} from "./CollectionViewTypes.js";
export {
    RDF_TYPE,
    TERN_COLLECTION_VIEW,
    TERN_COLLECTION_VIEW_ITEM,
    TERN_CV_ITEM,
    TERN_CV_PROP,
    TERN_CV_SORT_DIR,
    TERN_CV_SORT_PROP,
    TERN_CV_SOURCE,
    TERN_CVI_POS,
    TERN_CVI_REF,
    TERN_CVI_VIEW,
    TERN_VIEW_NS,
    XSD_BOOLEAN,
    XSD_DATETIME,
    XSD_DECIMAL,
    XSD_INTEGER,
    XSD_STRING,
} from "./constants.js";
export type { EntityRecord } from "./EntityRecord.js";
export { type DefaultValue, EntitySchema } from "./EntitySchema.js";
export { EntityValidationError } from "./EntityValidationError.js";
export type { FilterOp } from "./FilterOp.js";
export { TernAggregate } from "./TernAggregate.js";
export {
    entityIri,
    fromLiteral,
    idFromIri,
    invertPropertyMap,
    localName,
    newId,
    propertyMapFor,
    toLiteral,
} from "./util.js";
