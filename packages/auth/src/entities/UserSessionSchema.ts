import { randomBytes } from 'node:crypto';
import { EntitySchema, handle } from '@jasonscharf/entities';
import {
    UserSessionIRI,
    sessionTokenIRI, expiresAtIRI, isActiveIRI, ipAddressIRI,
    createdAtIRI, sessionUserIRI, sessionDeviceIRI,
} from '@jasonscharf/core';
import { AUTH_NS } from '../constants.js';


export const SessionCoreHandle = handle('tern:auth/session');

/**
 * EntitySchema for auth:UserSession.
 *
 * `sessionUser` and `sessionDevice` store the related entity IRIs as plain
 * strings, enabling equality filters in EntityQuery for join-style traversal:
 *   .where(SessionCoreHandle, 'sessionUser', '=', user.iri)
 */
export const UserSessionSchema = new EntitySchema({
    typeIRI:   UserSessionIRI,
    ns:        AUTH_NS,
    coreGroup: {
        handle: SessionCoreHandle,
        properties: {
            sessionToken:  sessionTokenIRI,
            expiresAt:     expiresAtIRI,
            isActive:      isActiveIRI,
            ipAddress:     ipAddressIRI,
            createdAt:     createdAtIRI,
            sessionUser:   sessionUserIRI,    // IRI string of the owning User
            sessionDevice: sessionDeviceIRI,  // IRI string of the associated UserDevice
        },
        defaults: {
            sessionToken: () => randomBytes(32).toString('hex'),
            createdAt:    () => new Date(),
            isActive:     true,
        },
    },
});
