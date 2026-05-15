import { EntitySchema, handle } from '@system/entities';
import {
    UserIRI,
    emailIRI, displayNameIRI, avatarUrlIRI,
    createdAtIRI, updatedAtIRI,
} from '@system/core';
import { AUTH_NS } from '../constants.js';


/**
 * The core PropGroup handle for auth:User.
 * All core User properties live here in the property graph.
 */
export const CoreHandle = handle('tern:core');

/**
 * EntitySchema for auth:User.
 *
 * Downstream packages extend it at startup:
 *   import { UserSchema } from '@system/auth';
 *   UserSchema.register(myPropGroup);
 */
export const UserSchema = new EntitySchema({
    typeIRI:   UserIRI,
    ns:        AUTH_NS,
    coreGroup: {
        handle:     CoreHandle,
        properties: {
            email:       emailIRI,
            displayName: displayNameIRI,
            avatarUrl:   avatarUrlIRI,
            createdAt:   createdAtIRI,
            updatedAt:   updatedAtIRI,
        },
        defaults: {
            createdAt: () => new Date(),
            updatedAt: () => new Date(),
        },
    },
});
