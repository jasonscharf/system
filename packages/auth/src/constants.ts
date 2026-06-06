import { IRI, NS_ROOT } from "@jasonscharf/core";
import { authEnv } from "./defaults.js";

export const AUTH_NS = `${NS_ROOT}auth:`;
export const AUTH_GRAPH = new IRI(`${AUTH_NS}graph`);

export const RDF_TYPE = new IRI("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
export const XSD_NS = "http://www.w3.org/2001/XMLSchema#";

export const XSD_STRING = new IRI(`${XSD_NS}string`);
export const XSD_BOOLEAN = new IRI(`${XSD_NS}boolean`);
export const XSD_DATETIME = new IRI(`${XSD_NS}dateTime`);
export const XSD_ANY_URI = new IRI(`${XSD_NS}anyURI`);

export const SESSION_COOKIE = authEnv.SESSION_COOKIE;
export const SESSION_TTL_SECS = parseInt(authEnv.SESSION_TTL_SECS, 10);

export const OAUTH_STATE_COOKIE = authEnv.OAUTH_STATE_COOKIE;
export const OAUTH_STATE_TTL = parseInt(authEnv.OAUTH_STATE_TTL, 10);

export const GOOGLE_CLIENT_ID = authEnv.GOOGLE_CLIENT_ID;
export const GOOGLE_CLIENT_SECRET = authEnv.GOOGLE_CLIENT_SECRET;
export const GITHUB_CLIENT_ID = authEnv.GITHUB_CLIENT_ID;
export const GITHUB_CLIENT_SECRET = authEnv.GITHUB_CLIENT_SECRET;
