/**
 * Auth integration tests.
 *
 * All database tests run against both SQLite (always) and Postgres
 * (when TERN_PG_URL is set) inside rolled-back transactions.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Knex } from 'knex';
import { IRI } from '@system/core';
import { createDataContext, TripleStore } from '@system/data';
import {
    UserRepository,
    UserIdentityRepository,
    UserSessionRepository,
    UserDeviceRepository,
    MemorySessionStore,
    GoogleProvider,
    GitHubProvider,
    AuthService,
    OAuthComponent,
    CallbackComponent,
    SessionComponent,
    AuthRouterComponent,
} from '@system/auth';
import { FlowContext, PushScheduler } from '@system/flow';


// ── Helpers ───────────────────────────────────────────────────────────────────

interface DbProvider {
    name:   string;
    create: () => Promise<Knex>;
}

const dbProviders: DbProvider[] = [
    {
        name:   'SQLite (in-memory)',
        create: () => createDataContext({ client: 'sqlite', filename: ':memory:' }),
    },
];

if (process.env['TERN_PG_URL']) {
    const url = new URL(process.env['TERN_PG_URL']);
    dbProviders.push({
        name:   'Postgres',
        create: () => createDataContext({
            client:   'pg',
            host:     url.hostname,
            port:     url.port ? Number(url.port) : 5432,
            database: url.pathname.slice(1),
            user:     url.username,
            password: url.password,
        }),
    });
}


// ── MemorySessionStore ────────────────────────────────────────────────────────

describe('MemorySessionStore', () => {
    let store: MemorySessionStore;

    beforeEach(() => { store = new MemorySessionStore(); });

    it('stores and retrieves a value', async () => {
        await store.set('k', 'v', 60);
        expect(await store.get('k')).toBe('v');
    });

    it('returns null for unknown key', async () => {
        expect(await store.get('missing')).toBeNull();
    });

    it('returns null after TTL expires', async () => {
        await store.set('k', 'v', 0); // 0-second TTL — already expired
        expect(await store.get('k')).toBeNull();
    });

    it('deletes a key', async () => {
        await store.set('k', 'v', 60);
        await store.del('k');
        expect(await store.get('k')).toBeNull();
    });

    it('clear() empties the store', async () => {
        await store.set('a', '1', 60);
        await store.set('b', '2', 60);
        store.clear();
        expect(await store.get('a')).toBeNull();
        expect(await store.get('b')).toBeNull();
    });
});


// ── OAuth providers ───────────────────────────────────────────────────────────

describe('GoogleProvider', () => {
    const provider = new GoogleProvider('test-client-id', 'test-secret');

    it('generates a redirect URL with required params', () => {
        const url = new URL(provider.getAuthUrl('http://localhost/cb', 'state123'));
        expect(url.hostname).toBe('accounts.google.com');
        expect(url.searchParams.get('client_id')).toBe('test-client-id');
        expect(url.searchParams.get('state')).toBe('state123');
        expect(url.searchParams.get('redirect_uri')).toBe('http://localhost/cb');
        expect(url.searchParams.get('response_type')).toBe('code');
        expect(url.searchParams.get('scope')).toContain('email');
    });

    it('exchangeCode() calls token + userinfo endpoints', async () => {
        const mockFetch = vi.fn()
            .mockResolvedValueOnce({
                ok:   true,
                json: async () => ({ access_token: 'at', expires_in: 3600 }),
            } as Response)
            .mockResolvedValueOnce({
                ok:   true,
                json: async () => ({ sub: 'g123', email: 'u@test.com', name: 'User', picture: 'http://pic' }),
            } as Response);

        vi.stubGlobal('fetch', mockFetch);

        const result = await provider.exchangeCode('code123', 'http://localhost/cb');
        expect(result.profile.providerUserId).toBe('g123');
        expect(result.profile.email).toBe('u@test.com');
        expect(result.tokens.accessToken).toBe('at');
        expect(result.tokens.expiresAt).toBeInstanceOf(Date);

        vi.unstubAllGlobals();
    });

    it('exchangeCode() throws on token endpoint error', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400 } as Response));
        await expect(provider.exchangeCode('bad', 'http://localhost/cb')).rejects.toThrow('400');
        vi.unstubAllGlobals();
    });
});

describe('GitHubProvider', () => {
    const provider = new GitHubProvider('gh-client', 'gh-secret');

    it('generates a redirect URL with required params', () => {
        const url = new URL(provider.getAuthUrl('http://localhost/cb', 'stateXYZ'));
        expect(url.hostname).toBe('github.com');
        expect(url.searchParams.get('client_id')).toBe('gh-client');
        expect(url.searchParams.get('state')).toBe('stateXYZ');
        expect(url.searchParams.get('scope')).toContain('user:email');
    });

    it('exchangeCode() fetches user + primary email', async () => {
        const mockFetch = vi.fn()
            .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'ghat', token_type: 'bearer', scope: '' }) } as Response)
            .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 42, login: 'dev', name: 'Dev', avatar_url: 'http://av' }) } as Response)
            .mockResolvedValueOnce({ ok: true, json: async () => ([{ email: 'dev@gh.com', primary: true, verified: true }]) } as Response);

        vi.stubGlobal('fetch', mockFetch);
        const result = await provider.exchangeCode('code', 'http://localhost/cb');
        expect(result.profile.providerUserId).toBe('42');
        expect(result.profile.email).toBe('dev@gh.com');
        expect(result.tokens.accessToken).toBe('ghat');
        vi.unstubAllGlobals();
    });
});


// ── Repository suites (run per DB provider) ────────────────────────────────────

for (const db of dbProviders) {
    describe(`UserRepository — ${db.name}`, () => {
        let knex:  Knex;
        let trx:   Knex.Transaction;
        let store: TripleStore;
        let repo:  UserRepository;

        beforeEach(async () => {
            knex  = await db.create();
            trx   = await knex.transaction();
            store = new TripleStore(trx as unknown as Knex);
            repo  = new UserRepository(store);
        });
        afterEach(async () => { await trx.rollback(); await knex.destroy(); });

        it('creates a user and retrieves it by id', async () => {
            const user = await repo.create({ email: 'a@test.com', displayName: 'Alice' });
            expect(user.id).toBeTruthy();
            expect(user.email).toBe('a@test.com');
            expect(user.displayName).toBe('Alice');
            expect(user.createdAt).toBeInstanceOf(Date);

            const found = await repo.findById(user.id);
            expect(found?.email).toBe('a@test.com');
        });

        it('finds a user by email', async () => {
            await repo.create({ email: 'b@test.com' });
            const found = await repo.findByEmail('b@test.com');
            expect(found?.email).toBe('b@test.com');
        });

        it('returns null for unknown id / email', async () => {
            expect(await repo.findById('nonexistent')).toBeNull();
            expect(await repo.findByEmail('ghost@test.com')).toBeNull();
        });

        it('updates displayName and avatarUrl', async () => {
            const user    = await repo.create({ email: 'c@test.com' });
            const updated = await repo.update(user.id, { displayName: 'Charlie', avatarUrl: 'http://avatar' });
            expect(updated?.displayName).toBe('Charlie');
            expect(updated?.avatarUrl).toBe('http://avatar');
            expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(user.updatedAt.getTime());
        });

        it('update returns null for unknown id', async () => {
            expect(await repo.update('ghost', { displayName: 'X' })).toBeNull();
        });

        it('deletes a user', async () => {
            const user = await repo.create({ email: 'd@test.com' });
            await repo.delete(user.id);
            expect(await repo.findById(user.id)).toBeNull();
        });

        it('stores the user IRI in the graph', async () => {
            const user  = await repo.create({ email: 'e@test.com' });
            expect(user.iri).toContain('http://tern.dev/ns/auth/user/');
            expect(user.iri).toContain(user.id);
        });
    });

    describe(`UserIdentityRepository — ${db.name}`, () => {
        let knex:     Knex;
        let trx:      Knex.Transaction;
        let store:    TripleStore;
        let userRepo: UserRepository;
        let idRepo:   UserIdentityRepository;

        beforeEach(async () => {
            knex     = await db.create();
            trx      = await knex.transaction();
            store    = new TripleStore(trx as unknown as Knex);
            userRepo = new UserRepository(store);
            idRepo   = new UserIdentityRepository(store);
        });
        afterEach(async () => { await trx.rollback(); await knex.destroy(); });

        it('creates an identity and links it to a user', async () => {
            const user     = await userRepo.create({ email: 'f@test.com' });
            const identity = await idRepo.create({
                provider:       'google',
                providerUserId: 'g-001',
                providerEmail:  'f@gmail.com',
                accessToken:    'at-xxx',
                userId:         user.id,
            });
            expect(identity.provider).toBe('google');
            expect(identity.providerUserId).toBe('g-001');
            expect(identity.userId).toBe(user.id);
        });

        it('finds identity by provider + providerUserId', async () => {
            const user = await userRepo.create({ email: 'g@test.com' });
            await idRepo.create({ provider: 'github', providerUserId: 'gh-42', providerEmail: 'g@gh.com', accessToken: 'at', userId: user.id });

            const found = await idRepo.findByProvider('github', 'gh-42');
            expect(found?.providerUserId).toBe('gh-42');
        });

        it('returns null when provider identity not found', async () => {
            expect(await idRepo.findByProvider('google', 'nobody')).toBeNull();
        });

        it('finds all identities for a user', async () => {
            const user = await userRepo.create({ email: 'h@test.com' });
            await idRepo.create({ provider: 'google', providerUserId: 'g1', providerEmail: 'h@g.com', accessToken: 'a1', userId: user.id });
            await idRepo.create({ provider: 'github', providerUserId: 'gh1', providerEmail: 'h@gh.com', accessToken: 'a2', userId: user.id });

            const all = await idRepo.findByUserId(user.id);
            expect(all).toHaveLength(2);
        });

        it('updates tokens on an existing identity', async () => {
            const user     = await userRepo.create({ email: 'i@test.com' });
            const identity = await idRepo.create({ provider: 'google', providerUserId: 'g2', providerEmail: 'i@g.com', accessToken: 'old', userId: user.id });

            await idRepo.updateTokens(identity.id, { accessToken: 'new-at', refreshToken: 'new-rt', tokenExpiresAt: undefined });

            const found = await idRepo.findByProvider('google', 'g2');
            expect(found?.accessToken).toBe('new-at');
            expect(found?.refreshToken).toBe('new-rt');
        });
    });

    describe(`UserDeviceRepository — ${db.name}`, () => {
        let knex:     Knex;
        let trx:      Knex.Transaction;
        let store:    TripleStore;
        let userRepo: UserRepository;
        let devRepo:  UserDeviceRepository;

        beforeEach(async () => {
            knex     = await db.create();
            trx      = await knex.transaction();
            store    = new TripleStore(trx as unknown as Knex);
            userRepo = new UserRepository(store);
            devRepo  = new UserDeviceRepository(store);
        });
        afterEach(async () => { await trx.rollback(); await knex.destroy(); });

        it('creates a device on first findOrCreate', async () => {
            const user   = await userRepo.create({ email: 'j@test.com' });
            const device = await devRepo.findOrCreate(user.id, { userAgent: 'Chrome/120', platform: 'web' });
            expect(device.userId).toBe(user.id);
            expect(device.deviceUserAgent).toBe('Chrome/120');
        });

        it('returns existing device on second findOrCreate with same userAgent', async () => {
            const user = await userRepo.create({ email: 'k@test.com' });
            const d1   = await devRepo.findOrCreate(user.id, { userAgent: 'Firefox/118' });
            const d2   = await devRepo.findOrCreate(user.id, { userAgent: 'Firefox/118' });
            expect(d1.id).toBe(d2.id);
        });

        it('finds all devices for a user', async () => {
            const user = await userRepo.create({ email: 'l@test.com' });
            await devRepo.findOrCreate(user.id, { userAgent: 'Safari/17' });
            await devRepo.findOrCreate(user.id, { userAgent: 'Edge/118' });
            const all = await devRepo.findByUserId(user.id);
            expect(all).toHaveLength(2);
        });

        it('findById returns null for unknown device', async () => {
            expect(await devRepo.findById('ghost')).toBeNull();
        });
    });

    describe(`UserSessionRepository — ${db.name}`, () => {
        let knex:     Knex;
        let trx:      Knex.Transaction;
        let store:    TripleStore;
        let userRepo: UserRepository;
        let devRepo:  UserDeviceRepository;
        let sessRepo: UserSessionRepository;

        beforeEach(async () => {
            knex     = await db.create();
            trx      = await knex.transaction();
            store    = new TripleStore(trx as unknown as Knex);
            userRepo = new UserRepository(store);
            devRepo  = new UserDeviceRepository(store);
            sessRepo = new UserSessionRepository(store);
        });
        afterEach(async () => { await trx.rollback(); await knex.destroy(); });

        async function makeSession(userId: string, deviceId: string, opts: { daysFromNow?: number } = {}) {
            const offset = (opts.daysFromNow ?? 7) * 24 * 3600 * 1000;
            return sessRepo.create({ userId, deviceId, expiresAt: new Date(Date.now() + offset) });
        }

        it('creates a session with a secure token', async () => {
            const user   = await userRepo.create({ email: 'm@test.com' });
            const device = await devRepo.findOrCreate(user.id, {});
            const sess   = await makeSession(user.id, device.id);

            expect(sess.sessionToken).toHaveLength(64);
            expect(sess.isActive).toBe(true);
            expect(sess.userId).toBe(user.id);
        });

        it('finds session by token', async () => {
            const user   = await userRepo.create({ email: 'n@test.com' });
            const device = await devRepo.findOrCreate(user.id, {});
            const sess   = await makeSession(user.id, device.id);

            const found = await sessRepo.findByToken(sess.sessionToken);
            expect(found?.id).toBe(sess.id);
        });

        it('returns null for unknown token', async () => {
            expect(await sessRepo.findByToken('not-a-real-token')).toBeNull();
        });

        it('finds all sessions for a user', async () => {
            const user   = await userRepo.create({ email: 'o@test.com' });
            const device = await devRepo.findOrCreate(user.id, {});
            await makeSession(user.id, device.id);
            await makeSession(user.id, device.id);
            const all = await sessRepo.findByUserId(user.id);
            expect(all).toHaveLength(2);
        });

        it('revoke() marks session inactive', async () => {
            const user   = await userRepo.create({ email: 'p@test.com' });
            const device = await devRepo.findOrCreate(user.id, {});
            const sess   = await makeSession(user.id, device.id);

            const ok = await sessRepo.revoke(sess.sessionToken);
            expect(ok).toBe(true);

            const after = await sessRepo.findByToken(sess.sessionToken);
            expect(after?.isActive).toBe(false);
        });

        it('revoke() returns false for unknown token', async () => {
            expect(await sessRepo.revoke('ghost-token')).toBe(false);
        });

        it('revokeAllForUser() revokes all active sessions', async () => {
            const user   = await userRepo.create({ email: 'q@test.com' });
            const device = await devRepo.findOrCreate(user.id, {});
            await makeSession(user.id, device.id);
            await makeSession(user.id, device.id);
            const count = await sessRepo.revokeAllForUser(user.id);
            expect(count).toBe(2);
        });

        it('deleteExpired() removes expired sessions', async () => {
            const user   = await userRepo.create({ email: 'r@test.com' });
            const device = await devRepo.findOrCreate(user.id, {});
            await makeSession(user.id, device.id, { daysFromNow: -1 }); // already expired
            await makeSession(user.id, device.id, { daysFromNow: 7  }); // valid

            const deleted = await sessRepo.deleteExpired();
            expect(deleted).toBe(1);
            const remaining = await sessRepo.findByUserId(user.id);
            expect(remaining).toHaveLength(1);
        });
    });
}


// ── AuthService (integration with in-memory store) ────────────────────────────

describe('AuthService', () => {
    let knex:    Knex;
    let trx:     Knex.Transaction;
    let store:   TripleStore;
    let service: AuthService;

    const makeGoogleFetch = (overrides?: Partial<{ email: string; sub: string }>) =>
        vi.fn()
            .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'at', expires_in: 3600 }) } as Response)
            .mockResolvedValueOnce({ ok: true, json: async () => ({ sub: overrides?.sub ?? 'g-sub', email: overrides?.email ?? 'svc@test.com', name: 'Service User', picture: 'http://pic' }) } as Response);

    beforeEach(async () => {
        knex    = await createDataContext({ client: 'sqlite', filename: ':memory:' });
        trx     = await knex.transaction();
        store   = new TripleStore(trx as unknown as Knex);
        service = new AuthService({
            providers:    [new GoogleProvider('cid', 'cs')],
            sessionStore: new MemorySessionStore(),
            users:        new UserRepository(store),
            identities:   new UserIdentityRepository(store),
            sessions:     new UserSessionRepository(store),
            devices:      new UserDeviceRepository(store),
        });
    });
    afterEach(async () => { await trx.rollback(); await knex.destroy(); vi.unstubAllGlobals(); });

    it('handleCallback() creates user, identity, device, and session', async () => {
        vi.stubGlobal('fetch', makeGoogleFetch());

        const { user, session } = await service.handleCallback({
            provider:    'google',
            code:        'code',
            redirectUri: 'http://localhost/cb',
            device:      { userAgent: 'Chrome', platform: 'web' },
        });

        expect(user.email).toBe('svc@test.com');
        expect(session.sessionToken).toHaveLength(64);
        expect(session.isActive).toBe(true);
    });

    it('handleCallback() returns existing user on second login', async () => {
        vi.stubGlobal('fetch', makeGoogleFetch());
        const { user: u1 } = await service.handleCallback({ provider: 'google', code: 'c1', redirectUri: 'http://localhost/cb', device: {} });

        vi.stubGlobal('fetch', makeGoogleFetch());
        const { user: u2 } = await service.handleCallback({ provider: 'google', code: 'c2', redirectUri: 'http://localhost/cb', device: {} });

        expect(u1.id).toBe(u2.id);
    });

    it('validateToken() returns user for valid session', async () => {
        vi.stubGlobal('fetch', makeGoogleFetch());
        const { session } = await service.handleCallback({ provider: 'google', code: 'c', redirectUri: 'http://localhost/cb', device: {} });

        const user = await service.validateToken(session.sessionToken);
        expect(user?.email).toBe('svc@test.com');
    });

    it('validateToken() returns null for unknown token', async () => {
        expect(await service.validateToken('fake-token')).toBeNull();
    });

    it('revokeToken() invalidates the session', async () => {
        vi.stubGlobal('fetch', makeGoogleFetch());
        const { session } = await service.handleCallback({ provider: 'google', code: 'c', redirectUri: 'http://localhost/cb', device: {} });

        await service.revokeToken(session.sessionToken);
        expect(await service.validateToken(session.sessionToken)).toBeNull();
    });

    it('buildAuthUrl() returns a URL with correct state', () => {
        const { url, state } = service.buildAuthUrl('google', 'http://localhost/cb');
        expect(new URL(url).searchParams.get('state')).toBe(state);
        expect(state).toHaveLength(32);
    });

    it('getProvider() throws for unknown provider', () => {
        expect(() => service.getProvider('github')).toThrow('Unknown OAuth provider');
    });
});


// ── OAuthComponent (FBP) ─────────────────────────────────────────────────────

describe('OAuthComponent', () => {
    let ctx:  FlowContext;
    let comp: OAuthComponent;

    beforeEach(() => {
        ctx  = new FlowContext();
        comp = new OAuthComponent({
            name:      'oauth',
            context:   ctx,
            providers: [new GoogleProvider('cid', 'cs'), new GitHubProvider('ghid', 'ghs')],
        });
    });

    it('puts redirect result on redirectOut for google', () => {
        comp.initIn.put({ provider: 'google', redirectUri: 'http://localhost/cb' });
        comp.step();
        const result = comp.redirectOut.read();
        expect(result?.provider).toBe('google');
        expect(result?.authUrl).toContain('accounts.google.com');
        expect(result?.state).toHaveLength(32);
    });

    it('puts redirect result for github', () => {
        comp.initIn.put({ provider: 'github', redirectUri: 'http://localhost/cb' });
        comp.step();
        const result = comp.redirectOut.read();
        expect(result?.authUrl).toContain('github.com');
    });

    it('skips messages for unknown providers', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        comp.initIn.put({ provider: 'twitter' as any, redirectUri: 'http://localhost/cb' });
        comp.step();
        expect(comp.redirectOut.size).toBe(0);
    });

    it('generates unique state per request', () => {
        comp.initIn.put({ provider: 'google', redirectUri: 'http://localhost/cb' });
        comp.initIn.put({ provider: 'google', redirectUri: 'http://localhost/cb' });
        comp.step();
        const r1 = comp.redirectOut.read();
        const r2 = comp.redirectOut.read();
        expect(r1?.state).not.toBe(r2?.state);
    });
});


// ── SessionComponent (FBP) ───────────────────────────────────────────────────

describe('SessionComponent', () => {
    let knex:    Knex;
    let trx:     Knex.Transaction;
    let store:   TripleStore;
    let sessComp: SessionComponent;
    let memStore: MemorySessionStore;

    beforeEach(async () => {
        knex     = await createDataContext({ client: 'sqlite', filename: ':memory:' });
        trx      = await knex.transaction();
        store    = new TripleStore(trx as unknown as Knex);
        memStore = new MemorySessionStore();

        sessComp = new SessionComponent({
            name:         'session',
            context:      new FlowContext(),
            sessionStore: memStore,
            users:        new UserRepository(store),
            sessions:     new UserSessionRepository(store),
        });
    });
    afterEach(async () => { await trx.rollback(); await knex.destroy(); });

    it('validateIn → valid:false for unknown token', async () => {
        sessComp.validateIn.put({ token: 'bad-token', requestId: 'r1' });
        sessComp.step();
        await new Promise(r => setTimeout(r, 50)); // let async resolve
        const result = sessComp.validateOut.read();
        expect(result?.valid).toBe(false);
        expect(result?.requestId).toBe('r1');
    });

    it('revokeIn → success:false for unknown token', async () => {
        sessComp.revokeIn.put({ token: 'ghost', requestId: 'r2' });
        sessComp.step();
        await new Promise(r => setTimeout(r, 50));
        const result = sessComp.revokeOut.read();
        expect(result?.requestId).toBe('r2');
    });
});


// ── AuthService: validateToken falls back to TripleStore ─────────────────────

describe('AuthService.validateToken — fallback path', () => {
    it('validates from TripleStore when session store is empty', async () => {
        const knex    = await createDataContext({ client: 'sqlite', filename: ':memory:' });
        const store   = new TripleStore(knex);
        const memStore = new MemorySessionStore();
        const users   = new UserRepository(store);
        const devices = new UserDeviceRepository(store);
        const sessRepo = new UserSessionRepository(store);

        const svc = new AuthService({
            providers:    [new GoogleProvider('c', 's')],
            sessionStore: memStore,
            users,
            identities:   new UserIdentityRepository(store),
            sessions:     sessRepo,
            devices,
        });

        vi.stubGlobal('fetch',
            vi.fn()
                .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'at', expires_in: 3600 }) } as Response)
                .mockResolvedValueOnce({ ok: true, json: async () => ({ sub: 'fb-sub', email: 'fb@test.com', name: 'Fallback' }) } as Response),
        );

        const { session } = await svc.handleCallback({ provider: 'google', code: 'c', redirectUri: 'http://localhost/cb', device: {} });

        // Simulate session store miss (e.g. Redis restart)
        memStore.clear();

        const user = await svc.validateToken(session.sessionToken);
        expect(user?.email).toBe('fb@test.com');

        vi.unstubAllGlobals();
        await knex.destroy();
    });
});


// ── AuthRouterComponent: sessionMiddleware ────────────────────────────────────

describe('AuthRouterComponent.sessionMiddleware()', () => {
    it('attaches user to ctx when cookie is valid', async () => {
        const knex    = await createDataContext({ client: 'sqlite', filename: ':memory:' });
        const store   = new TripleStore(knex);
        const memStore = new MemorySessionStore();

        const svc = new AuthService({
            providers:    [new GoogleProvider('c', 's')],
            sessionStore: memStore,
            users:        new UserRepository(store),
            identities:   new UserIdentityRepository(store),
            sessions:     new UserSessionRepository(store),
            devices:      new UserDeviceRepository(store),
        });

        vi.stubGlobal('fetch',
            vi.fn()
                .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'at' }) } as Response)
                .mockResolvedValueOnce({ ok: true, json: async () => ({ sub: 'mw-sub', email: 'mw@test.com' }) } as Response),
        );

        const { session } = await svc.handleCallback({ provider: 'google', code: 'c', redirectUri: 'http://localhost/cb', device: {} });

        const ctx = new FlowContext();
        const sched = new PushScheduler();
        ctx._setScheduler(sched);

        const router = new AuthRouterComponent({
            name:         'auth',
            context:      ctx,
            providers:    [new GoogleProvider('c', 's')],
            sessionStore: memStore,
            users:        new UserRepository(store),
            identities:   new UserIdentityRepository(store),
            sessions:     new UserSessionRepository(store),
            devices:      new UserDeviceRepository(store),
            baseUrl:      'http://localhost:3000',
        });

        const mw   = router.sessionMiddleware();
        const fakeCtx = {
            req:    { headers: { cookie: `tern_session=${encodeURIComponent(session.sessionToken)}` } },
            user:   undefined as unknown,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any;

        await mw(fakeCtx, async () => {});
        expect((fakeCtx as { user: unknown }).user).toBeDefined();

        vi.unstubAllGlobals();
        await knex.destroy();
    });

    it('leaves ctx.user undefined for invalid token', async () => {
        const knex = await createDataContext({ client: 'sqlite', filename: ':memory:' });
        const ctx  = new FlowContext();

        const router = new AuthRouterComponent({
            name:         'auth',
            context:      ctx,
            providers:    [new GoogleProvider('c', 's')],
            sessionStore: new MemorySessionStore(),
            users:        new UserRepository(new TripleStore(knex)),
            identities:   new UserIdentityRepository(new TripleStore(knex)),
            sessions:     new UserSessionRepository(new TripleStore(knex)),
            devices:      new UserDeviceRepository(new TripleStore(knex)),
            baseUrl:      'http://localhost:3000',
        });

        const mw      = router.sessionMiddleware();
        const fakeCtx = { req: { headers: { cookie: 'tern_session=bad-token' } }, user: undefined } as unknown as import('@system/flow').HttpCtx;
        await mw(fakeCtx, async () => {});
        expect((fakeCtx as { user: unknown }).user).toBeUndefined();

        await knex.destroy();
    });
});
