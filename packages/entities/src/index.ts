export type {
    CollectionViewItemRecord,
    CollectionViewOpts,
    CollectionViewRecord,
} from "./CollectionViewTypes.js";
export {
    RDF_TYPE,
    SYS_COLLECTION_VIEW,
    SYS_COLLECTION_VIEW_ITEM,
    SYS_CV_ITEM,
    SYS_CV_PROP,
    SYS_CV_SORT_DIR,
    SYS_CV_SORT_PROP,
    SYS_CV_SOURCE,
    SYS_CVI_POS,
    SYS_CVI_REF,
    SYS_CVI_VIEW,
    SYS_VIEW_NS,
    XSD_BOOLEAN,
    XSD_DATETIME,
    XSD_DECIMAL,
    XSD_INTEGER,
    XSD_STRING,
} from "./constants.js";
export type { EdgeCardinality, EdgeDef, EdgeDirection } from "./EdgeDef.js";
export type { EdgeHandle, EdgeRef, EdgeSet } from "./EdgeHandle.js";
export type { EntityRecord } from "./EntityRecord.js";
export { type DefaultValue, EntitySchema, type PropertyDef, propIri } from "./EntitySchema.js";
export { EntityValidationError } from "./EntityValidationError.js";
export type { FilterOp } from "./FilterOp.js";
export { TernAggregate } from "./TernAggregate.js";
export {
    entityIri,
    entityIriFor,
    fromLiteral,
    idFromIri,
    invertPropertyMap,
    localName,
    newId,
    propertyMapFor,
    toLiteral,
} from "./util.js";
