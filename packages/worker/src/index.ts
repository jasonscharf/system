import { IRI } from "@jasonscharf/core";
import { PinoLogger } from "@jasonscharf/telemetry";

const logger = new PinoLogger("worker");

logger.info("Worker start");

setInterval(() => {
    const _foo = new IRI("http://foo");
    logger.debug("Worker heartbeat");
}, 2000);
