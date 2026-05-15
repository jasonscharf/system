# Entity System
The Entity System (ES) is designed to operate as a graph-native storage layer with a simple API on top for CRUD and query operations.

## Requirements
- RDF (.ttl) files produce entity types via codegen
- These RDF files also define SHaCL types and other validation/constraints
- Validation and constraints are enforced in code
- The API layer and development experience is CRUCIAL:
    - Defining new entity types must be simple
    - Performing database migrations for entity changes must be simple
    - Creating, updating, querying, deleting entities must be transactional

- Entities are to be stored as property graphs
- The extension model is inherent to the system and must be considered
    - i.e. a "Preferences" augments the user type in a downstream application pulling in code/entities/RDF from "data"
- Attributes ("props") are nodes, the graph is entirely normalized
- Props belong to "PropGroups" to keep entities clean

## Eample
A "User" entity exists in "core".
A developer building an extension may extend User in RDF (and therefor in code) by adding one or more property groups.
If their extension slug is "MyExtension" and it adds "Notes" and "Tags", a full User being queried for all fields would have User.MyExtension.Notes and User.MyExtension.Tags objects. These in turn would have the properties and/or relations for Notes and Tags respectively

When querying entities, extension code can ask for all extensions, or just particular ones.

Extensions should provide "handles" for querying propgroup and interacting with extensions in general. For example, "MyExtension" should export a handle object that ultimately resolves to a longer string.

export MyExtension = "com.foo.MyExtension";

Bonus points if we can work versioning in there and perhaps even use Symbol instead of string.

The point that is ABSOLUTELY CRITICAL is to make all entities cleanly extensible in RDF, types, and in the property graph.

## Graph
The User example above would look like so:

- A node for "User"
- A "Core" handle on a property group (another node)
- Property nodes for "firstName" and "lastName"

Later, an extension can install on save of entity or on extension installation new groups:

- A "MyExtension" node
- A "MyExtension.Tags" node, with its own property nodes
- A "MyExtension.Notes" node, with its own propery nodes

All entities and their extensions form well-defined graphs.

## Querying
The system should support a core "platform" query define in "core" that queries for entities and their extension data. Users should supply which extensions they want to include, or "all" for all. Ex:

const results = query.entities(User, "*");

Ideally this returns a Knex query that traverses the graph in Postgres for users and all extensions.

Knex query builder extension could then be tacked on to perform filteration, pagination, sorting, etc.