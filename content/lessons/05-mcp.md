# Model Context Protocol (MCP)

> Verify against the current specification at modelcontextprotocol.io; the protocol evolves.

## Roles
- **Host**: the AI application (IDE, chat app) — controls consent and what the model sees.
- **Client**: one connection to one server, inside the host.
- **Server**: exposes capabilities over JSON-RPC 2.0.

## Primitives (who controls them)
| Primitive | Controlled by | Example |
|---|---|---|
| Tools | Model (with host consent) | `record_review(questionId, grade)` |
| Resources | Application | `resource://profile/evidence` |
| Prompts | User | `/mock_interview topic` |

Client features include sampling (server asks the host's model), roots (filesystem boundaries) and elicitation (server asks the user).

## Transports
- **stdio**: local subprocess; no network surface; inherits user permissions.
- **Streamable HTTP**: remote/shared servers; needs auth (OAuth-based flow in the spec), origin validation, localhost binding when local.

## Security
- Treat descriptions and results as untrusted (tool poisoning, indirect injection).
- No token passthrough; per-tool authorization; least privilege.
- Allowlist and pin third-party servers; sandbox; watch for rug-pull updates.
- Confirm writes and anything that sends data out.

## Safe file operations (project 3)
Narrow typed tools, root confinement, schema validation, atomic writes, revision checks, proposals for consequential changes, audit log, no delete tool.
