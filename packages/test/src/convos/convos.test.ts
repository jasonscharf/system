/**
 * Convos integration tests.
 *
 * Runs against both SQLite (always) and Postgres (when TERN_PG_URL is set),
 * each operation inside a rolled-back transaction for clean isolation.
 *
 * Suites:
 *   ConversationRepository — CRUD, subject/inbox queries, status/assignment
 *   MessageRepository     — create, edit (revisions), soft-delete, threading
 *   ParticipantRepository — add, remove, role change, idempotent add
 *   DraftRepository       — save, update, delete, find by author
 *   InboxRepository       — create, membership, find by subject
 *   NotificationRepository — create, read, dismiss, fan-out, unread count
 *   ReadReceiptRepository — upsert watermark, find by user+conversation
 *   ConvoService (no RBAC) — orchestrated happy-path scenarios
 *   ConvoService + RBAC   — permission grant/deny per operation
 *   installConvos         — seeds permissions and roles
 */

import {
    ConversationRepository,
    ConvoService,
    DraftRepository,
    InboxRepository,
    installConvos,
    MessageRepository,
    NotificationRepository,
    ParticipantRepository,
    PERM_CONVO_CLOSE,
    PERM_CONVO_CREATE,
    PERM_INBOX_CREATE,
    PERM_MESSAGE_EDIT_ANY,
    PERM_MESSAGE_EDIT_OWN,
    PERM_MESSAGE_POST,
    ReadReceiptRepository,
    uninstallConvos,
} from "@jasonscharf/convos";
import { createDataContext, TripleStore } from "@jasonscharf/data";
import {
    PermissionRepository,
    PolicyGrantRepository,
    RbacService,
    ResourceNodeRepository,
    RoleRepository,
    ServiceAccountRepository,
    TenantRepository,
    UserGroupRepository,
} from "@jasonscharf/rbac";
import type { Knex } from "knex";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { up as seedRbac } from "../../../data/src/migrations/004_rbac.js";

// ── Provider matrix ───────────────────────────────────────────────────────────

interface DbProvider {
    name: string;
    create(): Promise<Knex>;
}

const providers: DbProvider[] = [
    {
        name: "SQLite (in-memory)",
        create: () => createDataContext({ client: "sqlite", filename: ":memory:" }),
    },
];

if (process.env.TERN_PG_URL) {
    const url = new URL(process.env.TERN_PG_URL);
    providers.push({
        name: "Postgres",
        create: () =>
            createDataContext({
                client: "pg",
                host: url.hostname,
                port: url.port ? Number(url.port) : 5432,
                database: url.pathname.slice(1),
                user: url.username,
                password: url.password,
            }),
    });
}

// ── Synthetic IRIs ────────────────────────────────────────────────────────────

const ALICE = "http://tern.dev/ns/auth/user/alice";
const BOB = "http://tern.dev/ns/auth/user/bob";
const CHARLIE = "http://tern.dev/ns/auth/user/charlie";

const CONTRACT_IRI = "http://tern.dev/ns/crm/contract/c001";
const USER_SUBJECT_IRI = "http://tern.dev/ns/auth/user/alice";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRepos(store: TripleStore) {
    return {
        conversations: new ConversationRepository(store),
        messages: new MessageRepository(store),
        participants: new ParticipantRepository(store),
        drafts: new DraftRepository(store),
        inboxes: new InboxRepository(store),
        notifications: new NotificationRepository(store),
        receipts: new ReadReceiptRepository(store),
    };
}

function makeService(store: TripleStore): ConvoService {
    return new ConvoService(makeRepos(store));
}

function makeRbacService(store: TripleStore): RbacService {
    return new RbacService({
        store,
        tenants: new TenantRepository(store),
        groups: new UserGroupRepository(store),
        roles: new RoleRepository(store),
        grants: new PolicyGrantRepository(store),
        permissions: new PermissionRepository(store),
        resources: new ResourceNodeRepository(store),
        serviceAccounts: new ServiceAccountRepository(store),
    });
}

function makeServiceWithRbac(store: TripleStore, rbac: RbacService): ConvoService {
    return new ConvoService({ ...makeRepos(store), rbac });
}

// ═════════════════════════════════════════════════════════════════════════════

for (const provider of providers) {
    // ── ConversationRepository ────────────────────────────────────────────────

    describe(`ConversationRepository — ${provider.name}`, () => {
        let knex: Knex;
        let trx: Knex.Transaction;
        let store: TripleStore;
        let repo: ConversationRepository;

        beforeEach(async () => {
            knex = await provider.create();
            trx = await knex.transaction();
            store = new TripleStore(knex);
            repo = new ConversationRepository(store);
        });
        afterEach(async () => {
            await trx.rollback();
            await knex.destroy();
        });

        it("creates a conversation and retrieves it by id", async () => {
            const c = await repo.create(
                { trx },
                { subjectIri: CONTRACT_IRI, title: "Q4 review", createdBy: ALICE },
            );
            expect(c.title).toBe("Q4 review");
            expect(c.subjectIri).toBe(CONTRACT_IRI);
            expect(c.status).toBe("open");
            expect(c.createdBy).toBe(ALICE);
            expect(c.inboxId).toBeNull();
            expect(c.assignedTo).toBeNull();
            expect((await repo.findById({ trx }, c.id))?.title).toBe("Q4 review");
        });

        it("stores the IRI under the convos namespace", async () => {
            const c = await repo.create(
                { trx },
                { subjectIri: CONTRACT_IRI, title: "t", createdBy: ALICE },
            );
            expect(c.iri).toContain("http://tern.dev/ns/convos/conversation/");
            expect(c.iri).toContain(c.id);
        });

        it("returns null for unknown id", async () => {
            expect(await repo.findById({ trx }, "ghost-id")).toBeNull();
        });

        it("finds conversations by subject IRI", async () => {
            await repo.create({ trx }, { subjectIri: CONTRACT_IRI, title: "A", createdBy: ALICE });
            await repo.create({ trx }, { subjectIri: CONTRACT_IRI, title: "B", createdBy: BOB });
            await repo.create(
                { trx },
                { subjectIri: "http://other.iri", title: "C", createdBy: ALICE },
            );
            const found = await repo.findBySubject({ trx }, CONTRACT_IRI);
            expect(found).toHaveLength(2);
            expect(found.map((c) => c.title)).toEqual(expect.arrayContaining(["A", "B"]));
        });

        it("findBySubject returns empty when no conversations exist", async () => {
            expect(await repo.findBySubject({ trx }, "http://nothing.test")).toHaveLength(0);
        });

        it("updates status", async () => {
            const c = await repo.create(
                { trx },
                { subjectIri: CONTRACT_IRI, title: "t", createdBy: ALICE },
            );
            const updated = await repo.updateStatus({ trx }, c.id, "closed");
            expect(updated?.status).toBe("closed");
            expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(c.updatedAt.getTime());
        });

        it("updateStatus returns null for unknown id", async () => {
            expect(await repo.updateStatus({ trx }, "ghost", "closed")).toBeNull();
        });

        it("updates assignment and clears it", async () => {
            const c = await repo.create(
                { trx },
                { subjectIri: CONTRACT_IRI, title: "t", createdBy: ALICE },
            );
            expect((await repo.updateAssignment({ trx }, c.id, BOB))?.assignedTo).toBe(BOB);
            expect((await repo.updateAssignment({ trx }, c.id, null))?.assignedTo).toBeNull();
        });

        it("creates with optional inboxId and assignedTo", async () => {
            const c = await repo.create(
                { trx },
                {
                    subjectIri: CONTRACT_IRI,
                    title: "t",
                    createdBy: ALICE,
                    inboxId: "inbox-id",
                    assignedTo: BOB,
                },
            );
            expect(c.inboxId).toBe("inbox-id");
            expect(c.assignedTo).toBe(BOB);
        });

        it("deletes a conversation", async () => {
            const c = await repo.create(
                { trx },
                { subjectIri: CONTRACT_IRI, title: "t", createdBy: ALICE },
            );
            await repo.delete({ trx }, c.id);
            expect(await repo.findById({ trx }, c.id)).toBeNull();
        });
    });

    // ── MessageRepository ─────────────────────────────────────────────────────

    describe(`MessageRepository — ${provider.name}`, () => {
        let knex: Knex;
        let trx: Knex.Transaction;
        let store: TripleStore;
        let convRepo: ConversationRepository;
        let msgRepo: MessageRepository;

        beforeEach(async () => {
            knex = await provider.create();
            trx = await knex.transaction();
            store = new TripleStore(knex);
            convRepo = new ConversationRepository(store);
            msgRepo = new MessageRepository(store);
        });
        afterEach(async () => {
            await trx.rollback();
            await knex.destroy();
        });

        it("posts and retrieves a message", async () => {
            const c = await convRepo.create(
                { trx },
                { subjectIri: CONTRACT_IRI, title: "t", createdBy: ALICE },
            );
            const m = await msgRepo.create({ trx }, {
                conversationId: c.id,
                authorId: ALICE,
                content: "Hello world",
                contentType: "text/markdown",
            });
            expect(m.content).toBe("Hello world");
            expect(m.isDeleted).toBe(false);
            expect(m.revisionCount).toBe(0);
            expect(m.replyToId).toBeNull();
            expect((await msgRepo.findById({ trx }, m.id))?.content).toBe("Hello world");
        });

        it("lists messages sorted by creation time", async () => {
            const c = await convRepo.create(
                { trx },
                { subjectIri: CONTRACT_IRI, title: "t", createdBy: ALICE },
            );
            await msgRepo.create({ trx }, {
                conversationId: c.id, authorId: ALICE, content: "first", contentType: "text/markdown",
            });
            await msgRepo.create({ trx }, {
                conversationId: c.id, authorId: BOB, content: "second", contentType: "text/markdown",
            });
            const msgs = await msgRepo.findByConversation({ trx }, c.id);
            expect(msgs).toHaveLength(2);
            expect(msgs[0].content).toBe("first");
            expect(msgs[1].content).toBe("second");
        });

        it("does not return participants as messages", async () => {
            const c = await convRepo.create(
                { trx },
                { subjectIri: CONTRACT_IRI, title: "t", createdBy: ALICE },
            );
            const partRepo = new ParticipantRepository(store);
            await partRepo.create({ trx }, { conversationId: c.id, userId: ALICE, role: "owner" });
            await msgRepo.create({ trx }, {
                conversationId: c.id, authorId: ALICE, content: "msg", contentType: "text/markdown",
            });
            const msgs = await msgRepo.findByConversation({ trx }, c.id);
            expect(msgs).toHaveLength(1);
            expect(msgs[0].content).toBe("msg");
        });

        it("supports threaded replies via replyToId", async () => {
            const c = await convRepo.create(
                { trx },
                { subjectIri: CONTRACT_IRI, title: "t", createdBy: ALICE },
            );
            const parent = await msgRepo.create({ trx }, {
                conversationId: c.id, authorId: ALICE, content: "parent", contentType: "text/markdown",
            });
            const reply = await msgRepo.create({ trx }, {
                conversationId: c.id, authorId: BOB, content: "reply",
                contentType: "text/markdown", replyToId: parent.id,
            });
            expect(reply.replyToId).toBe(parent.id);
        });

        it("edit saves a revision snapshot and updates content + revisionCount", async () => {
            const c = await convRepo.create(
                { trx },
                { subjectIri: CONTRACT_IRI, title: "t", createdBy: ALICE },
            );
            const m = await msgRepo.create({ trx }, {
                conversationId: c.id, authorId: ALICE, content: "original", contentType: "text/markdown",
            });
            const result = await msgRepo.edit({ trx }, m.id, "updated", ALICE);
            expect(result?.message.content).toBe("updated");
            expect(result?.message.revisionCount).toBe(1);
            expect(result?.revision.content).toBe("original");
            expect(result?.revision.revision).toBe(0);
        });

        it("edit returns null for unknown or deleted message", async () => {
            expect(await msgRepo.edit({ trx }, "ghost", "x", ALICE)).toBeNull();
            const c = await convRepo.create(
                { trx },
                { subjectIri: CONTRACT_IRI, title: "t", createdBy: ALICE },
            );
            const m = await msgRepo.create({ trx }, {
                conversationId: c.id, authorId: ALICE, content: "bye", contentType: "text/markdown",
            });
            await msgRepo.softDelete({ trx }, m.id);
            expect(await msgRepo.edit({ trx }, m.id, "x", ALICE)).toBeNull();
        });

        it("findRevisionsForMessage returns ordered edit history", async () => {
            const c = await convRepo.create(
                { trx },
                { subjectIri: CONTRACT_IRI, title: "t", createdBy: ALICE },
            );
            const m = await msgRepo.create({ trx }, {
                conversationId: c.id, authorId: ALICE, content: "v0", contentType: "text/markdown",
            });
            await msgRepo.edit({ trx }, m.id, "v1", ALICE);
            await msgRepo.edit({ trx }, m.id, "v2", ALICE);
            const revs = await msgRepo.findRevisionsForMessage({ trx }, m.id);
            expect(revs).toHaveLength(2);
            expect(revs[0].content).toBe("v0");
            expect(revs[1].content).toBe("v1");
        });

        it("softDelete marks the message deleted", async () => {
            const c = await convRepo.create(
                { trx },
                { subjectIri: CONTRACT_IRI, title: "t", createdBy: ALICE },
            );
            const m = await msgRepo.create({ trx }, {
                conversationId: c.id, authorId: ALICE, content: "bye", contentType: "text/markdown",
            });
            expect((await msgRepo.softDelete({ trx }, m.id))?.isDeleted).toBe(true);
            expect(await msgRepo.softDelete({ trx }, "ghost")).toBeNull();
        });
    });

    // ── ParticipantRepository ─────────────────────────────────────────────────

    describe(`ParticipantRepository — ${provider.name}`, () => {
        let knex: Knex;
        let trx: Knex.Transaction;
        let store: TripleStore;
        let convRepo: ConversationRepository;
        let partRepo: ParticipantRepository;

        beforeEach(async () => {
            knex = await provider.create();
            trx = await knex.transaction();
            store = new TripleStore(knex);
            convRepo = new ConversationRepository(store);
            partRepo = new ParticipantRepository(store);
        });
        afterEach(async () => {
            await trx.rollback();
            await knex.destroy();
        });

        it("adds a participant and retrieves by conversation", async () => {
            const c = await convRepo.create(
                { trx },
                { subjectIri: CONTRACT_IRI, title: "t", createdBy: ALICE },
            );
            const p = await partRepo.create({ trx }, { conversationId: c.id, userId: ALICE, role: "owner" });
            expect(p.userId).toBe(ALICE);
            expect(p.role).toBe("owner");
            expect(await partRepo.findByConversation({ trx }, c.id)).toHaveLength(1);
        });

        it("create is idempotent", async () => {
            const c = await convRepo.create(
                { trx },
                { subjectIri: CONTRACT_IRI, title: "t", createdBy: ALICE },
            );
            const p1 = await partRepo.create({ trx }, { conversationId: c.id, userId: ALICE, role: "owner" });
            const p2 = await partRepo.create({ trx }, { conversationId: c.id, userId: ALICE, role: "member" });
            expect(p1.id).toBe(p2.id);
        });

        it("findByConversationAndUser returns null for non-participant", async () => {
            const c = await convRepo.create(
                { trx },
                { subjectIri: CONTRACT_IRI, title: "t", createdBy: ALICE },
            );
            await partRepo.create({ trx }, { conversationId: c.id, userId: BOB, role: "member" });
            expect((await partRepo.findByConversationAndUser({ trx }, c.id, BOB))?.userId).toBe(BOB);
            expect(await partRepo.findByConversationAndUser({ trx }, c.id, CHARLIE)).toBeNull();
        });

        it("updateRole changes the role", async () => {
            const c = await convRepo.create(
                { trx },
                { subjectIri: CONTRACT_IRI, title: "t", createdBy: ALICE },
            );
            const p = await partRepo.create({ trx }, { conversationId: c.id, userId: BOB, role: "member" });
            expect((await partRepo.updateRole({ trx }, p.id, "viewer"))?.role).toBe("viewer");
        });

        it("remove deletes the participant", async () => {
            const c = await convRepo.create(
                { trx },
                { subjectIri: CONTRACT_IRI, title: "t", createdBy: ALICE },
            );
            const p = await partRepo.create({ trx }, { conversationId: c.id, userId: BOB, role: "member" });
            await partRepo.remove({ trx }, p.id);
            expect(await partRepo.findByConversation({ trx }, c.id)).toHaveLength(0);
        });
    });

    // ── DraftRepository ───────────────────────────────────────────────────────

    describe(`DraftRepository — ${provider.name}`, () => {
        let knex: Knex;
        let trx: Knex.Transaction;
        let store: TripleStore;
        let convRepo: ConversationRepository;
        let draftRepo: DraftRepository;

        beforeEach(async () => {
            knex = await provider.create();
            trx = await knex.transaction();
            store = new TripleStore(knex);
            convRepo = new ConversationRepository(store);
            draftRepo = new DraftRepository(store);
        });
        afterEach(async () => {
            await trx.rollback();
            await knex.destroy();
        });

        it("saves and retrieves a draft", async () => {
            const c = await convRepo.create(
                { trx },
                { subjectIri: CONTRACT_IRI, title: "t", createdBy: ALICE },
            );
            const d = await draftRepo.create({ trx }, {
                conversationId: c.id, authorId: ALICE, content: "draft", contentType: "text/markdown",
            });
            expect(d.content).toBe("draft");
            expect(await draftRepo.findById({ trx }, d.id)).not.toBeNull();
            expect(await draftRepo.findById({ trx }, "ghost")).toBeNull();
        });

        it("finds drafts by author, filtered by conversation", async () => {
            const c = await convRepo.create(
                { trx },
                { subjectIri: CONTRACT_IRI, title: "t", createdBy: ALICE },
            );
            await draftRepo.create({ trx }, {
                conversationId: c.id, authorId: ALICE, content: "d1", contentType: "text/markdown",
            });
            await draftRepo.create({ trx }, {
                conversationId: c.id, authorId: BOB, content: "d2", contentType: "text/markdown",
            });
            expect(await draftRepo.findByAuthor({ trx }, ALICE)).toHaveLength(1);
            expect(await draftRepo.findByAuthorAndConversation({ trx }, ALICE, c.id)).toHaveLength(1);
            expect(await draftRepo.findByAuthorAndConversation({ trx }, BOB, c.id)).toHaveLength(1);
        });

        it("updates and deletes a draft", async () => {
            const c = await convRepo.create(
                { trx },
                { subjectIri: CONTRACT_IRI, title: "t", createdBy: ALICE },
            );
            const d = await draftRepo.create({ trx }, {
                conversationId: c.id, authorId: ALICE, content: "old", contentType: "text/markdown",
            });
            expect((await draftRepo.update({ trx }, d.id, "new"))?.content).toBe("new");
            expect(await draftRepo.update({ trx }, "ghost", "x")).toBeNull();
            await draftRepo.delete({ trx }, d.id);
            expect(await draftRepo.findById({ trx }, d.id)).toBeNull();
        });
    });

    // ── InboxRepository ───────────────────────────────────────────────────────

    describe(`InboxRepository — ${provider.name}`, () => {
        let knex: Knex;
        let trx: Knex.Transaction;
        let store: TripleStore;
        let inboxRepo: InboxRepository;

        beforeEach(async () => {
            knex = await provider.create();
            trx = await knex.transaction();
            store = new TripleStore(knex);
            inboxRepo = new InboxRepository(store);
        });
        afterEach(async () => {
            await trx.rollback();
            await knex.destroy();
        });

        it("creates and retrieves an inbox", async () => {
            const inbox = await inboxRepo.create(
                { trx },
                { subjectIri: CONTRACT_IRI, name: "Support", createdBy: ALICE },
            );
            expect(inbox.name).toBe("Support");
            expect((await inboxRepo.findById({ trx }, inbox.id))?.name).toBe("Support");
            expect(await inboxRepo.findById({ trx }, "ghost")).toBeNull();
        });

        it("finds inboxes by subject, skips unrelated subjects", async () => {
            await inboxRepo.create({ trx }, { subjectIri: CONTRACT_IRI, name: "A", createdBy: ALICE });
            await inboxRepo.create({ trx }, { subjectIri: CONTRACT_IRI, name: "B", createdBy: ALICE });
            await inboxRepo.create({ trx }, { subjectIri: "http://other", name: "C", createdBy: ALICE });
            expect(await inboxRepo.findBySubject({ trx }, CONTRACT_IRI)).toHaveLength(2);
        });

        it("adds and removes members idempotently", async () => {
            const inbox = await inboxRepo.create(
                { trx },
                { subjectIri: CONTRACT_IRI, name: "Team", createdBy: ALICE },
            );
            await inboxRepo.addMember({ trx }, inbox.id, ALICE, "owner");
            await inboxRepo.addMember({ trx }, inbox.id, BOB, "member");
            const m1 = await inboxRepo.addMember({ trx }, inbox.id, ALICE, "member");
            const m2 = await inboxRepo.addMember({ trx }, inbox.id, ALICE, "owner");
            expect(m1.id).toBe(m2.id);
            expect(await inboxRepo.listMembers({ trx }, inbox.id)).toHaveLength(2);
            await inboxRepo.removeMember({ trx }, inbox.id, BOB);
            expect(await inboxRepo.listMembers({ trx }, inbox.id)).toHaveLength(1);
        });

        it("listInboxesForUser returns all memberships", async () => {
            const a = await inboxRepo.create({ trx }, { subjectIri: CONTRACT_IRI, name: "A", createdBy: ALICE });
            const b = await inboxRepo.create({ trx }, { subjectIri: CONTRACT_IRI, name: "B", createdBy: ALICE });
            await inboxRepo.addMember({ trx }, a.id, BOB, "member");
            await inboxRepo.addMember({ trx }, b.id, BOB, "viewer");
            const mbs = await inboxRepo.listInboxesForUser({ trx }, BOB);
            expect(mbs.map((m) => m.inboxId)).toEqual(expect.arrayContaining([a.id, b.id]));
        });
    });

    // ── NotificationRepository ────────────────────────────────────────────────

    describe(`NotificationRepository — ${provider.name}`, () => {
        let knex: Knex;
        let trx: Knex.Transaction;
        let store: TripleStore;
        let notifRepo: NotificationRepository;

        beforeEach(async () => {
            knex = await provider.create();
            trx = await knex.transaction();
            store = new TripleStore(knex);
            notifRepo = new NotificationRepository(store);
        });
        afterEach(async () => {
            await trx.rollback();
            await knex.destroy();
        });

        it("creates, retrieves, and marks read", async () => {
            const n = await notifRepo.create(
                { trx },
                { userId: ALICE, notifType: "reply", sourceIri: "http://src/1" },
            );
            expect(n.isRead).toBe(false);
            expect((await notifRepo.findById({ trx }, n.id))?.notifType).toBe("reply");
            expect(await notifRepo.findById({ trx }, "ghost")).toBeNull();
            expect((await notifRepo.markRead({ trx }, n.id))?.isRead).toBe(true);
            expect(await notifRepo.markRead({ trx }, "ghost")).toBeNull();
        });

        it("findByUser with unreadOnly filters read notifications", async () => {
            const n1 = await notifRepo.create({ trx }, { userId: ALICE, notifType: "reply", sourceIri: "s1" });
            await notifRepo.create({ trx }, { userId: ALICE, notifType: "mention", sourceIri: "s2" });
            await notifRepo.create({ trx }, { userId: BOB, notifType: "reply", sourceIri: "s3" });
            await notifRepo.markRead({ trx }, n1.id);
            expect(await notifRepo.findByUser({ trx }, ALICE)).toHaveLength(2);
            expect(await notifRepo.findByUser({ trx }, ALICE, { unreadOnly: true })).toHaveLength(1);
        });

        it("markAllReadForUser returns count and clears unread", async () => {
            await notifRepo.create({ trx }, { userId: ALICE, notifType: "reply", sourceIri: "s1" });
            await notifRepo.create({ trx }, { userId: ALICE, notifType: "reply", sourceIri: "s2" });
            expect(await notifRepo.markAllReadForUser({ trx }, ALICE)).toBe(2);
            expect(await notifRepo.findByUser({ trx }, ALICE, { unreadOnly: true })).toHaveLength(0);
        });

        it("dismiss excludes from unread count", async () => {
            const n = await notifRepo.create(
                { trx },
                { userId: ALICE, notifType: "reply", sourceIri: "s" },
            );
            await notifRepo.dismiss({ trx }, n.id);
            expect(await notifRepo.countUnread({ trx }, ALICE)).toBe(0);
        });

        it("countUnread counts only non-dismissed unread notifications", async () => {
            await notifRepo.create({ trx }, { userId: ALICE, notifType: "reply", sourceIri: "s1" });
            await notifRepo.create({ trx }, { userId: ALICE, notifType: "mention", sourceIri: "s2" });
            const n3 = await notifRepo.create({ trx }, { userId: ALICE, notifType: "reply", sourceIri: "s3" });
            await notifRepo.markRead({ trx }, n3.id);
            expect(await notifRepo.countUnread({ trx }, ALICE)).toBe(2);
        });

        it("fanOut creates notifications for all except the excluded user", async () => {
            const created = await notifRepo.fanOut(
                { trx },
                [ALICE, BOB, CHARLIE],
                "http://src/msg",
                "reply",
                ALICE,
            );
            expect(created).toHaveLength(2);
            expect(created.map((n) => n.userId)).toEqual(expect.arrayContaining([BOB, CHARLIE]));
        });
    });

    // ── ReadReceiptRepository ─────────────────────────────────────────────────

    describe(`ReadReceiptRepository — ${provider.name}`, () => {
        let knex: Knex;
        let trx: Knex.Transaction;
        let store: TripleStore;
        let convRepo: ConversationRepository;
        let msgRepo: MessageRepository;
        let receiptRepo: ReadReceiptRepository;

        beforeEach(async () => {
            knex = await provider.create();
            trx = await knex.transaction();
            store = new TripleStore(knex);
            convRepo = new ConversationRepository(store);
            msgRepo = new MessageRepository(store);
            receiptRepo = new ReadReceiptRepository(store);
        });
        afterEach(async () => {
            await trx.rollback();
            await knex.destroy();
        });

        it("creates a read receipt for a user", async () => {
            const c = await convRepo.create(
                { trx },
                { subjectIri: CONTRACT_IRI, title: "t", createdBy: ALICE },
            );
            const m = await msgRepo.create({ trx }, {
                conversationId: c.id, authorId: ALICE, content: "hello", contentType: "text/markdown",
            });
            const r = await receiptRepo.upsert({ trx }, c.id, ALICE, m.id);
            expect(r.conversationId).toBe(c.id);
            expect(r.userId).toBe(ALICE);
            expect(r.lastReadMessageId).toBe(m.id);
        });

        it("upsert advances the watermark on second call", async () => {
            const c = await convRepo.create(
                { trx },
                { subjectIri: CONTRACT_IRI, title: "t", createdBy: ALICE },
            );
            const m1 = await msgRepo.create({ trx }, {
                conversationId: c.id, authorId: ALICE, content: "first", contentType: "text/markdown",
            });
            const m2 = await msgRepo.create({ trx }, {
                conversationId: c.id, authorId: BOB, content: "second", contentType: "text/markdown",
            });
            const r1 = await receiptRepo.upsert({ trx }, c.id, ALICE, m1.id);
            const r2 = await receiptRepo.upsert({ trx }, c.id, ALICE, m2.id);
            expect(r1.id).toBe(r2.id);
            expect(r2.lastReadMessageId).toBe(m2.id);
            expect(r2.lastReadAt.getTime()).toBeGreaterThanOrEqual(r1.lastReadAt.getTime());
        });

        it("findByConversationAndUser returns null when no receipt exists", async () => {
            const c = await convRepo.create(
                { trx },
                { subjectIri: CONTRACT_IRI, title: "t", createdBy: ALICE },
            );
            expect(await receiptRepo.findByConversationAndUser({ trx }, c.id, ALICE)).toBeNull();
        });

        it("findByConversation returns receipts for all users", async () => {
            const c = await convRepo.create(
                { trx },
                { subjectIri: CONTRACT_IRI, title: "t", createdBy: ALICE },
            );
            const m = await msgRepo.create({ trx }, {
                conversationId: c.id, authorId: ALICE, content: "msg", contentType: "text/markdown",
            });
            await receiptRepo.upsert({ trx }, c.id, ALICE, m.id);
            await receiptRepo.upsert({ trx }, c.id, BOB, m.id);
            const all = await receiptRepo.findByConversation({ trx }, c.id);
            expect(all).toHaveLength(2);
            expect(all.map((r) => r.userId)).toEqual(expect.arrayContaining([ALICE, BOB]));
        });
    });

    // ── ConvoService (no RBAC) ────────────────────────────────────────────────

    describe(`ConvoService — ${provider.name}`, () => {
        let knex: Knex;
        let trx: Knex.Transaction;
        let store: TripleStore;
        let svc: ConvoService;

        beforeEach(async () => {
            knex = await provider.create();
            trx = await knex.transaction();
            store = new TripleStore(knex);
            svc = makeService(store);
        });
        afterEach(async () => {
            await trx.rollback();
            await knex.destroy();
        });

        it("createConversation adds owner participant automatically", async () => {
            const { conversation } = await svc.createConversation({ trx }, ALICE, {
                subjectIri: CONTRACT_IRI,
                title: "Contract discussion",
            });
            expect(conversation.createdBy).toBe(ALICE);
            const parts = await svc.getParticipants({ trx }, conversation.id);
            expect(parts).toHaveLength(1);
            expect(parts[0].role).toBe("owner");
        });

        it("createConversation with initialMessage fans out notifications to other participants", async () => {
            const { message } = await svc.createConversation({ trx }, ALICE, {
                subjectIri: CONTRACT_IRI,
                title: "Welcome",
                initialMessage: "Hello!",
                participantIds: [BOB],
            });
            expect(message?.content).toBe("Hello!");
            expect(await svc.getNotificationsForUser({ trx }, BOB)).toHaveLength(1);
            expect(await svc.getNotificationsForUser({ trx }, ALICE)).toHaveLength(0);
        });

        it("postMessage creates notification for participants, not author", async () => {
            const { conversation } = await svc.createConversation({ trx }, ALICE, {
                subjectIri: CONTRACT_IRI,
                title: "t",
                participantIds: [BOB, CHARLIE],
            });
            await svc.postMessage({ trx }, ALICE, {
                conversationId: conversation.id,
                content: "Hey team",
            });
            expect(await svc.getNotificationsForUser({ trx }, BOB)).toHaveLength(1);
            expect(await svc.getNotificationsForUser({ trx }, CHARLIE)).toHaveLength(1);
            expect(await svc.getNotificationsForUser({ trx }, ALICE)).toHaveLength(0);
        });

        it("postMessage skips notification for user with a current read receipt", async () => {
            const { conversation } = await svc.createConversation({ trx }, ALICE, {
                subjectIri: CONTRACT_IRI,
                title: "t",
                participantIds: [BOB],
            });
            const msg = await svc.postMessage({ trx }, ALICE, {
                conversationId: conversation.id,
                content: "first message",
            });
            // BOB marks the first message as read — dismisses the msg1 notification
            await svc.markConversationRead({ trx }, BOB, conversation.id, msg.id);
            // New message posted after BOB's watermark — BOB gets exactly one new notification
            await svc.postMessage({ trx }, ALICE, {
                conversationId: conversation.id,
                content: "second message",
            });
            const notifs = await svc.getNotificationsForUser({ trx }, BOB);
            const active = notifs.filter((n) => !n.isDismissed);
            expect(active).toHaveLength(1);
        });

        it("editMessage returns updated content with revision", async () => {
            const { conversation } = await svc.createConversation({ trx }, ALICE, {
                subjectIri: CONTRACT_IRI, title: "t",
            });
            const msg = await svc.postMessage({ trx }, ALICE, {
                conversationId: conversation.id, content: "original",
            });
            const result = await svc.editMessage({ trx }, ALICE, msg.id, "updated");
            expect(result?.message.content).toBe("updated");
            expect(result?.revision.content).toBe("original");
        });

        it("deleteMessage soft-deletes", async () => {
            const { conversation } = await svc.createConversation({ trx }, ALICE, {
                subjectIri: CONTRACT_IRI, title: "t",
            });
            const msg = await svc.postMessage({ trx }, ALICE, {
                conversationId: conversation.id, content: "bye",
            });
            expect((await svc.deleteMessage({ trx }, ALICE, msg.id))?.isDeleted).toBe(true);
        });

        it("closeConversation updates status", async () => {
            const { conversation } = await svc.createConversation({ trx }, ALICE, {
                subjectIri: CONTRACT_IRI, title: "t",
            });
            expect((await svc.closeConversation({ trx }, ALICE, conversation.id))?.status).toBe("closed");
        });

        it("sendDraft promotes draft to message and removes the draft", async () => {
            const { conversation } = await svc.createConversation({ trx }, ALICE, {
                subjectIri: CONTRACT_IRI, title: "t",
            });
            const draft = await svc.createDraft({ trx }, {
                conversationId: conversation.id, authorId: ALICE, content: "my draft",
            });
            const message = await svc.sendDraft({ trx }, ALICE, draft.id);
            expect(message?.content).toBe("my draft");
            expect(await svc.getDraftsForAuthor({ trx }, ALICE)).toHaveLength(0);
        });

        it("createInbox adds owner membership for creator", async () => {
            const inbox = await svc.createInbox({ trx }, ALICE, {
                subjectIri: CONTRACT_IRI, name: "Support", memberIds: [BOB],
            });
            const members = await svc.getInboxMembers({ trx }, inbox.id);
            expect(members.map((m) => m.userId)).toEqual(expect.arrayContaining([ALICE, BOB]));
            expect(members.find((m) => m.userId === ALICE)?.role).toBe("owner");
        });

        it("getConversationsForSubject works with any subject IRI (cross-domain)", async () => {
            await svc.createConversation({ trx }, BOB, {
                subjectIri: USER_SUBJECT_IRI, title: "Alice profile thread",
            });
            const convos = await svc.getConversationsForSubject({ trx }, USER_SUBJECT_IRI);
            expect(convos).toHaveLength(1);
            expect(convos[0].subjectIri).toBe(USER_SUBJECT_IRI);
        });

        it("markAllNotificationsRead clears unread count", async () => {
            const { conversation } = await svc.createConversation({ trx }, ALICE, {
                subjectIri: CONTRACT_IRI, title: "t", participantIds: [BOB],
            });
            await svc.postMessage({ trx }, ALICE, { conversationId: conversation.id, content: "m1" });
            await svc.postMessage({ trx }, ALICE, { conversationId: conversation.id, content: "m2" });
            expect(await svc.getUnreadCount({ trx }, BOB)).toBe(2);
            expect(await svc.markAllNotificationsRead({ trx }, BOB)).toBe(2);
            expect(await svc.getUnreadCount({ trx }, BOB)).toBe(0);
        });
    });

    // ── Read receipts via ConvoService ────────────────────────────────────────

    describe(`ConvoService read receipts — ${provider.name}`, () => {
        let knex: Knex;
        let trx: Knex.Transaction;
        let store: TripleStore;
        let svc: ConvoService;

        beforeEach(async () => {
            knex = await provider.create();
            trx = await knex.transaction();
            store = new TripleStore(knex);
            svc = makeService(store);
        });
        afterEach(async () => {
            await trx.rollback();
            await knex.destroy();
        });

        it("markConversationRead sets a receipt and advances watermark", async () => {
            const { conversation } = await svc.createConversation({ trx }, ALICE, {
                subjectIri: CONTRACT_IRI, title: "t",
            });
            const m1 = await svc.postMessage({ trx }, ALICE, {
                conversationId: conversation.id, content: "first",
            });
            await svc.markConversationRead({ trx }, ALICE, conversation.id, m1.id);
            const r = await svc.getReadReceipt({ trx }, conversation.id, ALICE);
            expect(r?.lastReadMessageId).toBe(m1.id);

            const m2 = await svc.postMessage({ trx }, ALICE, {
                conversationId: conversation.id, content: "second",
            });
            await svc.markConversationRead({ trx }, ALICE, conversation.id, m2.id);
            const r2 = await svc.getReadReceipt({ trx }, conversation.id, ALICE);
            expect(r2?.lastReadMessageId).toBe(m2.id);
        });

        it("getUnreadMessageCount returns correct count relative to watermark", async () => {
            const { conversation } = await svc.createConversation({ trx }, ALICE, {
                subjectIri: CONTRACT_IRI, title: "t",
            });
            const m1 = await svc.postMessage({ trx }, ALICE, {
                conversationId: conversation.id, content: "msg1",
            });
            await svc.postMessage({ trx }, ALICE, {
                conversationId: conversation.id, content: "msg2",
            });
            await svc.postMessage({ trx }, ALICE, {
                conversationId: conversation.id, content: "msg3",
            });

            // No receipt — all messages are unread
            expect(await svc.getUnreadMessageCount({ trx }, conversation.id, BOB)).toBe(3);

            // Read through msg1 — two remain
            await svc.markConversationRead({ trx }, BOB, conversation.id, m1.id);
            expect(await svc.getUnreadMessageCount({ trx }, conversation.id, BOB)).toBe(2);
        });

        it("getReadReceiptsForConversation returns receipts for all readers", async () => {
            const { conversation } = await svc.createConversation({ trx }, ALICE, {
                subjectIri: CONTRACT_IRI, title: "t",
            });
            const m = await svc.postMessage({ trx }, ALICE, {
                conversationId: conversation.id, content: "x",
            });
            await svc.markConversationRead({ trx }, ALICE, conversation.id, m.id);
            await svc.markConversationRead({ trx }, BOB, conversation.id, m.id);
            const receipts = await svc.getReadReceiptsForConversation({ trx }, conversation.id);
            expect(receipts).toHaveLength(2);
        });

        it("markConversationRead dismisses pre-watermark notifications", async () => {
            const { conversation } = await svc.createConversation({ trx }, ALICE, {
                subjectIri: CONTRACT_IRI, title: "t", participantIds: [BOB],
            });
            const msg = await svc.postMessage({ trx }, ALICE, {
                conversationId: conversation.id, content: "hello",
            });
            expect(await svc.getUnreadCount({ trx }, BOB)).toBe(1);
            await svc.markConversationRead({ trx }, BOB, conversation.id, msg.id);
            expect(await svc.getUnreadCount({ trx }, BOB)).toBe(0);
        });
    });

    // ── ConvoService with RBAC ────────────────────────────────────────────────

    describe(`ConvoService + RBAC — ${provider.name}`, () => {
        let knex: Knex;
        let trx: Knex.Transaction;
        let store: TripleStore;
        let rbac: RbacService;
        let svc: ConvoService;

        beforeEach(async () => {
            knex = await provider.create();
            await seedRbac(knex);
            trx = await knex.transaction();
            store = new TripleStore(knex);
            rbac = makeRbacService(store);
            svc = makeServiceWithRbac(store, rbac);
        });
        afterEach(async () => {
            await trx.rollback();
            await knex.destroy();
        });

        it("createConversation denied without tern.convos:conversation.create", async () => {
            await expect(
                svc.createConversation({ trx }, ALICE, {
                    subjectIri: CONTRACT_IRI,
                    title: "Denied",
                }),
            ).rejects.toThrow(/Access denied/);
        });

        it("createConversation succeeds when permission is granted", async () => {
            const p = await rbac.createPermission({ trx }, PERM_CONVO_CREATE);
            const role = await rbac.createRole({ trx }, { roleName: "User", tenantId: null });
            await rbac.addPermissionToRole({ trx }, role.iri, p.iri);
            await rbac.grant({ trx }, { principalIri: ALICE, roleIri: role.iri });
            const { conversation } = await svc.createConversation({ trx }, ALICE, {
                subjectIri: CONTRACT_IRI, title: "OK",
            });
            expect(conversation.title).toBe("OK");
        });

        it("postMessage denied without tern.convos:message.post", async () => {
            const cp = await rbac.createPermission({ trx }, PERM_CONVO_CREATE);
            const role = await rbac.createRole({ trx }, { roleName: "Creator", tenantId: null });
            await rbac.addPermissionToRole({ trx }, role.iri, cp.iri);
            await rbac.grant({ trx }, { principalIri: ALICE, roleIri: role.iri });
            const { conversation } = await svc.createConversation({ trx }, ALICE, {
                subjectIri: CONTRACT_IRI, title: "t",
            });
            await expect(
                svc.postMessage({ trx }, BOB, { conversationId: conversation.id, content: "hi" }),
            ).rejects.toThrow(/Access denied/);
        });

        it("editMessage denied when BOB (non-author) lacks tern.convos:message.edit.any", async () => {
            const createP = await rbac.createPermission({ trx }, PERM_CONVO_CREATE);
            const postP = await rbac.createPermission({ trx }, PERM_MESSAGE_POST);
            const editOwnP = await rbac.createPermission({ trx }, PERM_MESSAGE_EDIT_OWN);
            const userRole = await rbac.createRole({ trx }, { roleName: "User", tenantId: null });
            await rbac.addPermissionToRole({ trx }, userRole.iri, createP.iri);
            await rbac.addPermissionToRole({ trx }, userRole.iri, postP.iri);
            await rbac.addPermissionToRole({ trx }, userRole.iri, editOwnP.iri);
            await rbac.grant({ trx }, { principalIri: ALICE, roleIri: userRole.iri });
            await rbac.grant({ trx }, { principalIri: BOB, roleIri: userRole.iri });

            const { conversation } = await svc.createConversation({ trx }, ALICE, {
                subjectIri: CONTRACT_IRI, title: "t",
            });
            const msg = await svc.postMessage({ trx }, ALICE, {
                conversationId: conversation.id, content: "alice's message",
            });
            await expect(
                svc.editMessage({ trx }, BOB, msg.id, "tampered"),
            ).rejects.toThrow(/Access denied/);
        });

        it("editMessage succeeds when moderator has tern.convos:message.edit.any", async () => {
            const createP = await rbac.createPermission({ trx }, PERM_CONVO_CREATE);
            const postP = await rbac.createPermission({ trx }, PERM_MESSAGE_POST);
            const editAnyP = await rbac.createPermission({ trx }, PERM_MESSAGE_EDIT_ANY);
            const userRole = await rbac.createRole({ trx }, { roleName: "User", tenantId: null });
            await rbac.addPermissionToRole({ trx }, userRole.iri, createP.iri);
            await rbac.addPermissionToRole({ trx }, userRole.iri, postP.iri);
            const modRole = await rbac.createRole({ trx }, { roleName: "Mod", tenantId: null });
            await rbac.addPermissionToRole({ trx }, modRole.iri, editAnyP.iri);
            await rbac.grant({ trx }, { principalIri: ALICE, roleIri: userRole.iri });
            await rbac.grant({ trx }, { principalIri: BOB, roleIri: modRole.iri });

            const { conversation } = await svc.createConversation({ trx }, ALICE, {
                subjectIri: CONTRACT_IRI, title: "t",
            });
            const msg = await svc.postMessage({ trx }, ALICE, {
                conversationId: conversation.id, content: "original",
            });
            const result = await svc.editMessage({ trx }, BOB, msg.id, "moderated");
            expect(result?.message.content).toBe("moderated");
        });

        it("closeConversation denied without tern.convos:conversation.close", async () => {
            const cp = await rbac.createPermission({ trx }, PERM_CONVO_CREATE);
            const role = await rbac.createRole({ trx }, { roleName: "User", tenantId: null });
            await rbac.addPermissionToRole({ trx }, role.iri, cp.iri);
            await rbac.grant({ trx }, { principalIri: ALICE, roleIri: role.iri });
            const { conversation } = await svc.createConversation({ trx }, ALICE, {
                subjectIri: CONTRACT_IRI, title: "t",
            });
            await expect(
                svc.closeConversation({ trx }, ALICE, conversation.id),
            ).rejects.toThrow(/Access denied/);
        });

        it("createInbox denied without tern.convos:inbox.create", async () => {
            await expect(
                svc.createInbox({ trx }, ALICE, { subjectIri: CONTRACT_IRI, name: "X" }),
            ).rejects.toThrow(/Access denied/);
        });

        it("full moderator role can create, post, edit any, close, and create inbox", async () => {
            const perms = [
                PERM_CONVO_CREATE,
                PERM_CONVO_CLOSE,
                PERM_MESSAGE_POST,
                PERM_MESSAGE_EDIT_ANY,
                PERM_INBOX_CREATE,
            ];
            const modRole = await rbac.createRole({ trx }, { roleName: "Mod", tenantId: null });
            for (const key of perms) {
                const p = await rbac.createPermission({ trx }, key);
                await rbac.addPermissionToRole({ trx }, modRole.iri, p.iri);
            }
            await rbac.grant({ trx }, { principalIri: ALICE, roleIri: modRole.iri });

            const { conversation } = await svc.createConversation({ trx }, ALICE, {
                subjectIri: CONTRACT_IRI, title: "Full access",
            });
            const msg = await svc.postMessage({ trx }, ALICE, {
                conversationId: conversation.id, content: "original",
            });
            expect((await svc.editMessage({ trx }, ALICE, msg.id, "edited"))?.message.content).toBe("edited");
            expect((await svc.closeConversation({ trx }, ALICE, conversation.id))?.status).toBe("closed");
            expect((await svc.createInbox({ trx }, ALICE, { subjectIri: CONTRACT_IRI, name: "Inbox" })).name).toBe("Inbox");
        });
    });

    // ── installConvos ─────────────────────────────────────────────────────────

    describe(`installConvos — ${provider.name}`, () => {
        let knex: Knex;
        let trx: Knex.Transaction;
        let store: TripleStore;
        let rbac: RbacService;

        beforeEach(async () => {
            knex = await provider.create();
            await seedRbac(knex);
            trx = await knex.transaction();
            store = new TripleStore(knex);
            rbac = makeRbacService(store);
        });
        afterEach(async () => {
            await trx.rollback();
            await knex.destroy();
        });

        it("seeds all convos permissions", async () => {
            const result = await installConvos({ trx }, rbac);
            for (const key of Object.keys(result.permissionIris)) {
                const found = await rbac.findPermissionByKey({ trx }, key);
                expect(found?.permissionKey).toBe(key);
            }
        });

        it("creates ConvoUser and ConvoModerator roles", async () => {
            const result = await installConvos({ trx }, rbac);
            expect(result.userRoleIri).toBeTruthy();
            expect(result.moderatorRoleIri).toBeTruthy();
            expect(result.userRoleIri).not.toBe(result.moderatorRoleIri);
        });

        it("ConvoUser role grants tern.convos:conversation.create", async () => {
            const result = await installConvos({ trx }, rbac);
            await rbac.grant({ trx }, { principalIri: ALICE, roleIri: result.userRoleIri });
            expect(
                await rbac.can({ trx }, { principal: ALICE, permission: PERM_CONVO_CREATE }),
            ).toBe(true);
        });

        it("ConvoModerator role grants tern.convos:conversation.close", async () => {
            const result = await installConvos({ trx }, rbac);
            await rbac.grant({ trx }, { principalIri: ALICE, roleIri: result.moderatorRoleIri });
            expect(
                await rbac.can({ trx }, { principal: ALICE, permission: PERM_CONVO_CLOSE }),
            ).toBe(true);
        });

        it("installConvos is idempotent for permissions (find-or-create)", async () => {
            const r1 = await installConvos({ trx }, rbac);
            const r2 = await installConvos({ trx }, rbac);
            expect(r1.permissionIris[PERM_CONVO_CREATE]).toBe(r2.permissionIris[PERM_CONVO_CREATE]);
        });

        it("uninstallConvos revokes the supplied grant IRIs", async () => {
            const result = await installConvos({ trx }, rbac);
            const grant = await rbac.grant({ trx }, {
                principalIri: ALICE,
                roleIri: result.userRoleIri,
            });
            expect(
                await rbac.can({ trx }, { principal: ALICE, permission: PERM_CONVO_CREATE }),
            ).toBe(true);
            await uninstallConvos({ trx }, rbac, [grant.iri]);
            expect(
                await rbac.can({ trx }, { principal: ALICE, permission: PERM_CONVO_CREATE }),
            ).toBe(false);
        });
    });
}
