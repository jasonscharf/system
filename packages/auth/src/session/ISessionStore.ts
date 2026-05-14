export interface ISessionStore {
    set(key: string, value: string, ttlSeconds: number): Promise<void>;
    get(key: string): Promise<string | null>;
    del(key: string): Promise<void>;
}
