import {
    createdAtIRI,
    deviceNameIRI,
    devicePlatformIRI,
    deviceUserAgentIRI,
    deviceUserIRI,
    UserDeviceIRI,
} from "@jasonscharf/core";
import { EntitySchema, handle } from "@jasonscharf/entities";
import { AUTH_NS } from "../constants.js";

export const DeviceCoreHandle = handle("tern:auth/device");

/**
 * EntitySchema for auth:UserDevice.
 *
 * `deviceUser` stores the owning User's entity IRI as a plain string so that
 * the EntityQuery `.where(DeviceCoreHandle, 'deviceUser', '=', user.iri)` filter
 * works for finding all devices belonging to a specific user.
 */
export const UserDeviceSchema = new EntitySchema({
    typeIRI: UserDeviceIRI,
    ns: AUTH_NS,
    coreGroup: {
        handle: DeviceCoreHandle,
        properties: {
            deviceName: deviceNameIRI,
            devicePlatform: devicePlatformIRI,
            deviceUserAgent: deviceUserAgentIRI,
            createdAt: createdAtIRI,
            deviceUser: deviceUserIRI, // IRI string of the owning User
        },
        defaults: { createdAt: () => new Date() },
    },
});
