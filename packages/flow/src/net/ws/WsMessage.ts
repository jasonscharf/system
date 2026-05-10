export interface WsMessage {
    readonly connectionId: string;
    readonly data: string | Uint8Array;
}
