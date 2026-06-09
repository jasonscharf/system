import { literal } from "@jasonscharf/core";
import type { TripleStore } from "@jasonscharf/data";
import type { SecurityContext } from "../SecurityContext.js";
import type { ServerContext } from "../ServerContext.js";
import {
	RDF_TYPE,
	SUPERUSER_GRAPH,
	SUPERUSERS_NODE,
	SuperuserIRI,
	XSD_ANY_URI,
	XSD_DATETIME,
	superuserGrantedAtIRI,
	superuserUserIRI,
} from "./constants.js";

export interface SuperuserArgs {
	/** IRI of the user whose superuser status is being read or changed. */
	userIri: string;
}

/**
 * Superuser membership — who has superuser privileges in the system.
 * Stores membership as a collection of user IRIs in the SUPERUSER_GRAPH.
 */
export class SuperuserRepository {
	private readonly _store: TripleStore;

	constructor(store: TripleStore) {
		this._store = store;
	}

	async isSuperuser(
		ctx: ServerContext,
		_sec: SecurityContext,
		args: SuperuserArgs,
	): Promise<boolean> {
		return this._store.withTransaction(ctx, async (ctx) => {
			const quads = await this._store.find(ctx, {
				subject: SUPERUSERS_NODE,
				predicate: superuserUserIRI,
				object: literal(args.userIri, XSD_ANY_URI),
				graph: SUPERUSER_GRAPH,
			});
			return quads.length > 0;
		});
	}

	async grant(ctx: ServerContext, _sec: SecurityContext, args: SuperuserArgs): Promise<void> {
		return this._store.withTransaction(ctx, async (ctx) => {
			const already = await this.isSuperuser(ctx, _sec, args);
			if (already) {
				return;
			}
			await this._store.insertMany(ctx, [
				{
					subject: SUPERUSERS_NODE,
					predicate: RDF_TYPE,
					object: SuperuserIRI,
					graph: SUPERUSER_GRAPH,
				},
				{
					subject: SUPERUSERS_NODE,
					predicate: superuserUserIRI,
					object: literal(args.userIri, XSD_ANY_URI),
					graph: SUPERUSER_GRAPH,
				},
				{
					subject: SUPERUSERS_NODE,
					predicate: superuserGrantedAtIRI,
					object: literal(new Date().toISOString(), XSD_DATETIME),
					graph: SUPERUSER_GRAPH,
				},
			]);
		});
	}

	async revoke(ctx: ServerContext, _sec: SecurityContext, args: SuperuserArgs): Promise<void> {
		return this._store.withTransaction(ctx, async (ctx) => {
			await this._store.delete(ctx, {
				subject: SUPERUSERS_NODE,
				predicate: superuserUserIRI,
				object: literal(args.userIri, XSD_ANY_URI),
				graph: SUPERUSER_GRAPH,
			});
		});
	}

	async list(ctx: ServerContext, _sec: SecurityContext): Promise<string[]> {
		return this._store.withTransaction(ctx, async (ctx) => {
			const quads = await this._store.find(ctx, {
				subject: SUPERUSERS_NODE,
				predicate: superuserUserIRI,
				graph: SUPERUSER_GRAPH,
			});
			return quads.map((q) => String((q.object as { value: string }).value));
		});
	}
}
