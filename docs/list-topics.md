# List topics

A list read has one shape everywhere: `ListQuery` in, `ListWindow` out
(`@jasonscharf/core/list`). An HTTP endpoint answers one window. A live topic
answers a stream of `ListFrame`s for the same query.

## The query

```ts
{
    sort: [{ field: "createdAt", direction: "desc" }],
    filters: [{ field: "superuser", op: "eq", value: true }],
    search: "ada",
    page: { offset: 0, limit: 25 },
}
```

A `ListSchema` names the fields a query may sort and filter on and the fields
search looks in. `normalizeListQuery` drops anything else, so a client cannot
reach a column the server did not offer. Rows are flat records of strings,
numbers, booleans and nulls; dates travel as ISO-8601 UTC strings.

## Frames

On subscribe the topic sends a `window` frame: the page plus a `version`, a
fingerprint of the rows the query admits. After that, when rows change, each
subscriber gets one of:

- nothing, when no row it can see changed;
- a `changes` frame (`from`, `to`, the changed rows with their old and new
  values), when every change can be placed on its page;
- a fresh `window` frame, when one cannot.

A subscriber applies `changes` only at version `from`. At `to` it already has
them (two servers can each push the same change). At any other version it
re-subscribes.

## The placement rule

`placeListChange` decides where one change lands on a page that holds only its
own rows:

- a row that matches neither before nor after the change is dropped;
- a row entering or moving within the page lands at its sorted position;
- a row entering below a full page moves only the total;
- a row entering or leaving above a later page shifts the page, and a row
  leaving the page leaves a gap only the next row below can fill, so both
  mean the page is read again.

The server and the browser run the same function on the same page, so the
server keeps no per-subscriber state beyond the query. `planListPush` is the
server half, `applyListFrame` the browser half.
