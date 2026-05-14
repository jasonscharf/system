import { IRI } from '@system/core';


export const AUTH_NS    = 'http://tern.dev/ns/auth/';
export const AUTH_GRAPH = new IRI(`${AUTH_NS}graph`);

export const RDF_TYPE = new IRI('http://www.w3.org/1999/02/22-rdf-syntax-ns#type');
export const XSD_NS   = 'http://www.w3.org/2001/XMLSchema#';

export const XSD_STRING   = new IRI(`${XSD_NS}string`);
export const XSD_BOOLEAN  = new IRI(`${XSD_NS}boolean`);
export const XSD_DATETIME = new IRI(`${XSD_NS}dateTime`);

export const SESSION_COOKIE   = 'tern_session';
export const SESSION_TTL_SECS = 7 * 24 * 60 * 60; // 7 days

export const OAUTH_STATE_COOKIE = 'tern_oauth_state';
export const OAUTH_STATE_TTL    = 10 * 60;           // 10 minutes

export const GOOGLE_CLIENT_ID     = process.env['GOOGLE_CLIENT_ID']     ?? 'placeholder_google_client_id';
export const GOOGLE_CLIENT_SECRET = process.env['GOOGLE_CLIENT_SECRET'] ?? 'placeholder_google_client_secret';
export const GITHUB_CLIENT_ID     = process.env['GITHUB_CLIENT_ID']     ?? 'placeholder_github_client_id';
export const GITHUB_CLIENT_SECRET = process.env['GITHUB_CLIENT_SECRET'] ?? 'placeholder_github_client_secret';
