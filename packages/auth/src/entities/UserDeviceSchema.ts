import {
    deviceNameIRI,
    devicePlatformIRI,
    deviceUserAgentIRI,
    deviceUserIRI,
    UserDeviceIRI,
} from "@jasonscharf/core";
import { EntitySchema } from "@jasonscharf/entities";
import { AUTH_GRAPH, AUTH_NS } from "../constants.js";

export const UserDeviceSchema = new EntitySchema({
    typeIRI: UserDeviceIRI,
    ns: AUTH_NS,
    graphIri: AUTH_GRAPH,
    properties: {
        deviceName: deviceNameIRI,
        devicePlatform: devicePlatformIRI,
        deviceUserAgent: deviceUserAgentIRI,
        deviceUser: deviceUserIRI,
    },
});
