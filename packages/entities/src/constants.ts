import { IRI } from "@jasonscharf/core";

export const TERN_NS = "http://tern.dev/ns/core/";
export const XSD_NS = "http://www.w3.org/2001/XMLSchema#";

export const RDF_TYPE = new IRI("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
export const TERN_PROP_GROUP = new IRI(`${TERN_NS}propGroup`);
export const TERN_HANDLE = new IRI(`${TERN_NS}handle`);

export const XSD_STRING = new IRI(`${XSD_NS}string`);
export const XSD_BOOLEAN = new IRI(`${XSD_NS}boolean`);
export const XSD_INTEGER = new IRI(`${XSD_NS}integer`);
export const XSD_DECIMAL = new IRI(`${XSD_NS}decimal`);
export const XSD_DATETIME = new IRI(`${XSD_NS}dateTime`);

// ── CollectionView / CollectionViewItem IRIs (see core/ontology/core.ttl) ────

export const TERN_VIEW_NS = `${TERN_NS}view/`;

export const TERN_COLLECTION_VIEW = new IRI(`${TERN_NS}CollectionView`);
export const TERN_COLLECTION_VIEW_ITEM = new IRI(`${TERN_NS}CollectionViewItem`);

export const TERN_CV_SOURCE = new IRI(`${TERN_NS}cvSource`); // view → source PropGroup IRI string
export const TERN_CV_PROP = new IRI(`${TERN_NS}cvProp`); // view → property IRI string
export const TERN_CV_SORT_PROP = new IRI(`${TERN_NS}cvSortProp`); // view → sort property IRI string
export const TERN_CV_SORT_DIR = new IRI(`${TERN_NS}cvSortDir`); // view → "asc"|"desc"
export const TERN_CV_ITEM = new IRI(`${TERN_NS}cvItem`); // view → CollectionViewItem node

export const TERN_CVI_VIEW = new IRI(`${TERN_NS}cviView`); // item → parent view (back-link)
export const TERN_CVI_REF = new IRI(`${TERN_NS}cviRef`); // item → referenced value string
export const TERN_CVI_POS = new IRI(`${TERN_NS}cviPos`); // item → integer position

// ── Schema registry (see core/ontology/core.ttl) ──────────────────────────────

export const TERN_SCHEMA_GRAPH = new IRI(`${TERN_NS}schema`);
export const TERN_FIELD = new IRI(`${TERN_NS}field`);
export const TERN_FIELD_NAME = new IRI(`${TERN_NS}fieldName`);
export const TERN_FIELD_IRI = new IRI(`${TERN_NS}fieldIRI`);
