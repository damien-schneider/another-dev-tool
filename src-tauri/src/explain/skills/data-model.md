---
name: data-model
description: Explain how data is shaped, stored, and related - database schemas, migrations, core types, state stores, API payloads. Use for "how is data stored", "what are the main entities", "what does X look like", "how do A and B relate".
---

# Explain the data model

Goal: the reader can picture the main entities, how they relate, where each lives, and the rules that keep them consistent.

## Gather (one parallel batch)

- Storage definitions: `Glob` for `**/migrations/**`, `**/*schema*`, `**/*.sql`, `**/*.prisma`, `**/models/**`, `**/entities/**`.
- Core types: `Grep` for `struct `, `interface `, `type .* = \{`, `class .*Model`, `@Entity`, `Schema(` in the main source folders.
- State stores and caches: `Grep` for `createStore`, `create(`, `useReducer`, `Mutex<`, `Redis`, `localStorage`.

## Understand it

- Keep the 3 to 10 entities that matter; skip join tables and DTO copies unless they carry meaning.
- For each: its identity (key), the few fields that define it, and where it is persisted.
- Relations: one-to-many, many-to-many, ownership, cascades on delete.
- Rules: unique constraints, invariants enforced in code, migrations that changed meaning.

## Answer shape

1. One sentence naming the central entity and what hangs off it.
2. A `diagram` of entities (`kind: "store"` for tables or persisted stores; `detail` lists 2 or 3 key fields) with labeled edges (`has many`, `belongs to`, `caches`).
3. A `files` block pointing at the schema and the core types.
4. Detailed and up: the consistency rules and an `excerpt` of the most important definition.
