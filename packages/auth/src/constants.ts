import { IRI, makeUri, NS_CORE } from "@jasonscharf/core";
import { authEnv } from "./defaults.js";

export const AUTH_NS = makeUri(NS_CORE, "auth");

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

// ── Auth abuse controls (TRN-171) ──────────────────────────────────────────────

export const AUTH_THROTTLE_WINDOW_SECS = parseInt(authEnv.AUTH_THROTTLE_WINDOW_SECS, 10);
export const AUTH_THROTTLE_MAX_PER_IP = parseInt(authEnv.AUTH_THROTTLE_MAX_PER_IP, 10);
export const AUTH_THROTTLE_MAX_PER_IDENTITY = parseInt(authEnv.AUTH_THROTTLE_MAX_PER_IDENTITY, 10);
export const AUTH_NEG_CACHE_TTL_SECS = parseInt(authEnv.AUTH_NEG_CACHE_TTL_SECS, 10);

/** Parsed allowlist of trusted reverse-proxy IPs (empty = trust none, use socket peer). */
export const AUTH_TRUSTED_PROXIES: string[] = authEnv.AUTH_TRUSTED_PROXIES.split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

/** Sentinel value stored in the session store to mark a token as known-invalid. */
export const NEG_CACHE_SENTINEL = "__neg__";
