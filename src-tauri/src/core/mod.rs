//! Transport-agnostic domain logic.
//!
//! Everything in here takes plain handles — a `rusqlite::Connection`, the local
//! file store, the authenticated Quanta client — and returns plain data. Tauri
//! commands today, and an HTTP or MCP server later, are thin adapters over this
//! module, so no logic is trapped inside a command handler.
//!
//! One rule that is easy to get wrong: a `Connection` guard is a non-reentrant
//! mutex. Never hold it across an `.await` that itself needs the connection.
//! Commands read under the lock, drop it for the network call, then re-acquire
//! to write back.

pub mod files;
pub mod mirror;
