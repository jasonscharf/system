import { type IRI, literal } from "@jasonscharf/core";
import {
	TenantIRI,
	tenantCreatedAtIRI,
	tenantNameIRI,
	tenantUpdatedAtIRI,
	tenantUserIRI,
} from "@jasonscharf/core/tenancy";
import type { TripleStore } from "@jasonscharf/data";
import type { SecurityContext } from "../SecurityContext.js";
import type { ServerContext } from "../ServerContext.js";
import {
	RDF_TYPE,
	TENANCY_GRAPH,
	XSD_ANY_URI,
	XSD_DATETIME,
	XSD_STRING,
} from "./constants.js";
import type { TenantEntity } from "./types.js";
import { idFrom, iriFor, newId } from "./util.js";

export interface CreateTenantArgs {
	name: string;
}

export interface TenantIdArgs {
	id: string;
}

export interface TenantUserArgs {
	tenantId: string;
	userIri: string;
}

export interface UpdateTenantArgs {
	id: string;
	patch: Partial<Pick<TenantEntity, "name">>;
}

export class TenantRepository {
	constructor(private readonly _store: TripleStore) {}

	async create(
		ctx: ServerContext,
		_sec: SecurityContext,
		args: CreateTenantArgs,
	): Promise<TenantEntity> {
		const id = newId();
		const now = new Date();
		const sub = iriFor("tenant", id);

		await this._store.insertMany(ctx, [
			{ subject: sub, predicate: RDF_TYPE, object: TenantIRI, graph: TENANCY_GRAPH },
			{
				subject: sub,
				predicate: tenantNameIRI,
				object: literal(args.name, XSD_STRING),
				graph: TENANCY_GRAPH,
			},
			{
				subject: sub,
				predicate: tenantCreatedAtIRI,
				object: literal(now.toISOString(), XSD_DATETIME),
				graph: TENANCY_GRAPH,
			},
			{
				subject: sub,
				predicate: tenantUpdatedAtIRI,
				object: literal(now.toISOString(), XSD_DATETIME),
				graph: TENANCY_GRAPH,
			},
		]);

		return { id, iri: sub.value, name: args.name, createdAt: now, updatedAt: now };
	}

	async findById(
		ctx: ServerContext,
		_sec: SecurityContext,
		args: TenantIdArgs,
	): Promise<TenantEntity | null> {
		const sub = iriFor("tenant", args.id);
		const quads = await this._store.find(ctx, { subject: sub, graph: TENANCY_GRAPH });
		return quads.length === 0 ? null : this._fromQuads(args.id, quads);
	}

	async addUser(ctx: ServerContext, _sec: SecurityContext, args: TenantUserArgs): Promise<void> {
		await this._store.insert(ctx, {
			subject: iriFor("tenant", args.tenantId),
			predicate: tenantUserIRI,
			object: literal(args.userIri, XSD_ANY_URI),
			graph: TENANCY_GRAPH,
		});
	}

	async removeUser(
		ctx: ServerContext,
		_sec: SecurityContext,
		args: TenantUserArgs,
	): Promise<void> {
		await this._store.delete(ctx, {
			subject: iriFor("tenant", args.tenantId),
			predicate: tenantUserIRI,
			object: literal(args.userIri, XSD_ANY_URI),
			graph: TENANCY_GRAPH,
		});
	}

	async findUsers(
		ctx: ServerContext,
		_sec: SecurityContext,
		args: TenantIdArgs,
	): Promise<string[]> {
		const quads = await this._store.find(ctx, {
			subject: iriFor("tenant", args.id),
			predicate: tenantUserIRI,
			graph: TENANCY_GRAPH,
		});
		return quads.map((q) => String((q.object as { value: string }).value));
	}

	async findByUser(
		ctx: ServerContext,
		_sec: SecurityContext,
		args: { userIri: string },
	): Promise<TenantEntity[]> {
		const quads = await this._store.find(ctx, {
			predicate: tenantUserIRI,
			object: literal(args.userIri, XSD_ANY_URI),
			graph: TENANCY_GRAPH,
		});
		const entities: TenantEntity[] = [];
		for (const q of quads) {
			const id = idFrom((q.subject as IRI).value);
			const entity = await this.findById(ctx, _sec, { id });
			if (entity) {
				entities.push(entity);
			}
		}
		return entities;
	}

	async update(
		ctx: ServerContext,
		_sec: SecurityContext,
		args: UpdateTenantArgs,
	): Promise<TenantEntity | null> {
		const existing = await this.findById(ctx, _sec, { id: args.id });
		if (!existing) {
			return null;
		}

		const now = new Date();
		const sub = iriFor("tenant", args.id);

		if (args.patch.name !== undefined) {
			await this._store.delete(ctx, {
				subject: sub,
				predicate: tenantNameIRI,
				graph: TENANCY_GRAPH,
			});
			await this._store.insert(ctx, {
				subject: sub,
				predicate: tenantNameIRI,
				object: literal(args.patch.name, XSD_STRING),
				graph: TENANCY_GRAPH,
			});
		}

		await this._store.delete(ctx, {
			subject: sub,
			predicate: tenantUpdatedAtIRI,
			graph: TENANCY_GRAPH,
		});
		await this._store.insert(ctx, {
			subject: sub,
			predicate: tenantUpdatedAtIRI,
			object: literal(now.toISOString(), XSD_DATETIME),
			graph: TENANCY_GRAPH,
		});

		return this.findById(ctx, _sec, { id: args.id });
	}

	async delete(ctx: ServerContext, _sec: SecurityContext, args: TenantIdArgs): Promise<void> {
		await this._store.delete(ctx, { subject: iriFor("tenant", args.id), graph: TENANCY_GRAPH });
	}

	async listAll(ctx: ServerContext, _sec: SecurityContext): Promise<TenantEntity[]> {
		const quads = await this._store.find(ctx, { predicate: RDF_TYPE, object: TenantIRI, graph: TENANCY_GRAPH });
		const tenantsBySubject = new Map<string, typeof quads>();
		for (const quad of quads) {
			const subjectKey = (quad.subject as IRI).value;
			const existing = tenantsBySubject.get(subjectKey) ?? [];
			existing.push(quad);
			tenantsBySubject.set(subjectKey, existing);
		}

		const tenants: TenantEntity[] = [];
		for (const [subjectKey, subjectQuads] of tenantsBySubject) {
			const id = idFrom(subjectKey);
			const allQuads = subjectQuads.concat(await this._store.find(ctx, { subject: { value: subjectKey } as IRI, graph: TENANCY_GRAPH }));
			tenants.push(this._fromQuads(id, allQuads));
		}
		return tenants;
	}

	private _fromQuads(
		id: string,
		quads: ReturnType<TripleStore["find"]> extends Promise<infer T> ? T : never,
	): TenantEntity {
		const get = (pred: IRI): string | undefined => {
			const q = quads.find((q) => (q.predicate as IRI).value === pred.value);
			return q !== undefined ? String((q.object as { value: string }).value) : undefined;
		};

		return {
			id,
			iri: iriFor("tenant", id).value,
			name: get(tenantNameIRI) ?? "",
			createdAt: new Date(get(tenantCreatedAtIRI) ?? 0),
			updatedAt: new Date(get(tenantUpdatedAtIRI) ?? 0),
		};
	}
}
