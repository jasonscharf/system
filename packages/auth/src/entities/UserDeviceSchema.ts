import {
    deviceNameIRI,
    devicePlatformIRI,
    deviceUserAgentIRI,
    deviceUserIRI,
    UserDeviceIRI,
} from "@terncosoftware/core";
import { EntitySchema } from "@terncosoftware/entities";
import { AUTH_NS } from "../constants.js";

export const UserDeviceSchema = new EntitySchema({
    typeIRI: UserDeviceIRI,
    ns: AUTH_NS,
    properties: {
        deviceName: deviceNameIRI,
        devicePlatform: devicePlatformIRI,
        deviceUserAgent: deviceUserAgentIRI,
        deviceUser: deviceUserIRI,
    },
});
