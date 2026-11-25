mod catalog;
mod lockdown;
mod prepare;
mod protocol;
mod rpc;
mod translate;
mod turn;

#[cfg(test)]
mod turn_tests;

use std::path::Path;

use serde_json::{json, Value};

pub use catalog::{Catalog, Launch, Listing};
pub use lockdown::{real_paths, setup, Scope};
pub use prepare::{prepare, sign_in, Prepared, SignIn};
use protocol::Initialized;
use rpc::{Agent, Client, Failure, RpcError};
pub use turn::{run, Control, Turn};

/// An agent that has agreed on the protocol version and told what it can do.
struct Connection {
    agent: Agent,
    init: Initialized,
}

fn connect(launch: &Launch, cwd: &Path) -> Result<Connection, Failure> {
    let mut agent = Agent::spawn(launch, cwd)?;
    let init = agent.request(
        "initialize",
        json!({
            "protocolVersion": protocol::VERSION,
            "clientCapabilities": {
                "fs": { "readTextFile": false, "writeTextFile": false },
                "terminal": false,
                "auth": { "terminal": true },
            },
            "clientInfo": {
                "name": "another-dev-tool",
                "title": "Another Dev Tool",
                "version": env!("CARGO_PKG_VERSION"),
            },
        }),
        &mut Quiet,
    );
    match init.and_then(|init| serde_json::from_value(init).map_err(Failure::from)) {
        Ok(init) => Ok(Connection { agent, init }),
        Err(failure) => {
            agent.close();
            Err(failure)
        }
    }
}

/// A client with nothing to offer: used before any session exists.
struct Quiet;

impl Client for Quiet {
    fn notified(&mut self, _method: &str, _params: Value) {}

    fn requested(&mut self, method: &str, _params: Value) -> Result<Value, RpcError> {
        Err(RpcError::method_not_found(method))
    }
}
