export class TickEvent {
    readonly timestamp: number;

    constructor() {
        this.timestamp = Date.now();
    }
}

export function isTickEvent(msg: unknown): msg is TickEvent {
    return msg instanceof TickEvent;
}
