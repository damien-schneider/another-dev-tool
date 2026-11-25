use std::fs;
use std::os::unix::fs::PermissionsExt as _;
use std::path::Path;
use std::process::Command;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use serde::Serialize;
use serde_json::json;

use super::protocol::{categorized, AuthMethod, Choice, ConfigOption, SessionSetup, EFFORT, MODEL};
use super::{connect, Connection, Launch, Quiet};
use crate::error::{AppError, AppResult};

const SIGN_IN_LIMIT: Duration = Duration::from_secs(600);

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Picker {
    pub id: String,
    pub name: String,
    pub current: Option<String>,
    pub choices: Vec<Choice>,
}

/// What the composer offers for an agent before any conversation exists.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Prepared {
    pub images: bool,
    pub models: Option<Picker>,
    pub efforts: Option<Picker>,
    pub sign_in: Vec<AuthMethod>,
    pub needs_sign_in: bool,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SignIn {
    Done,
    InTerminal,
}

pub fn prepare(launch: &Launch, cwd: &Path) -> AppResult<Prepared> {
    let Connection { mut agent, init } = connect(launch, cwd)?;
    let capabilities = &init.agent_capabilities;
    let previewed = if capabilities.previews_options() {
        agent
            .request("session/options", json!({ "cwd": cwd }), &mut Quiet)
            .and_then(|options| Ok(serde_json::from_value::<SessionSetup>(options)?))
    } else {
        Ok(SessionSetup::default())
    };
    agent.close();
    let (options, needs_sign_in) = match previewed {
        Ok(setup) => (setup.config_options, false),
        Err(failure) if failure.needs_sign_in() => (vec![], true),
        Err(failure) => return Err(failure.into()),
    };
    Ok(Prepared {
        images: capabilities.prompt_capabilities.image,
        models: picker(&options, MODEL),
        efforts: picker(&options, EFFORT),
        sign_in: init.auth_methods,
        needs_sign_in,
    })
}

fn picker(options: &[ConfigOption], category: &str) -> Option<Picker> {
    let option = categorized(options, category)?;
    let choices = option.choices();
    (!choices.is_empty()).then(|| Picker {
        id: option.id.clone(),
        name: option.name.clone(),
        current: option.current().map(str::to_string),
        choices,
    })
}

/// A terminal method runs the agent's own login in Terminal and returns at
/// once; the agent's own method blocks until it's done or abandoned.
pub fn sign_in(launch: &Launch, cwd: &Path, method_id: &str) -> AppResult<SignIn> {
    let Connection { mut agent, init } = connect(launch, cwd)?;
    let Some(method) = init
        .auth_methods
        .iter()
        .find(|method| method.id == method_id)
    else {
        agent.close();
        return Err(AppError::NotFound(format!(
            "{} no longer offers this sign-in",
            launch.name
        )));
    };
    if method.in_terminal() {
        agent.close();
        open_in_terminal(
            &cwd.join("sign-in.command"),
            &terminal_script(launch, method),
        )?;
        return Ok(SignIn::InTerminal);
    }

    let (finished, abandoned) = mpsc::channel::<()>();
    let stopper = agent.stopper();
    thread::spawn(move || {
        if abandoned.recv_timeout(SIGN_IN_LIMIT) == Err(mpsc::RecvTimeoutError::Timeout) {
            stopper.terminate();
        }
    });
    let signed = agent.request("authenticate", json!({ "methodId": method_id }), &mut Quiet);
    drop(finished);
    agent.close();
    signed.map(|_| SignIn::Done).map_err(AppError::from)
}

fn open_in_terminal(path: &Path, script: &str) -> AppResult<()> {
    fs::write(path, script)?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o755))?;
    let opened = Command::new("/usr/bin/open")
        .args(["-a", "Terminal"])
        .arg(path)
        .status()?;
    if opened.success() {
        Ok(())
    } else {
        Err(AppError::internal("Terminal didn't open the sign-in"))
    }
}

/// The method's variables are exported last: they override the launch's own.
fn terminal_script(launch: &Launch, method: &AuthMethod) -> String {
    let exports: String = launch
        .env
        .iter()
        .chain(&method.env)
        .filter(|(name, _)| shell_name(name))
        .map(|(name, value)| format!("export {name}={}\n", quote(value)))
        .collect();
    let command: Vec<String> = std::iter::once(launch.program.to_string_lossy().into_owned())
        .chain(launch.args.iter().cloned())
        .chain(method.args.iter().cloned())
        .map(|word| quote(&word))
        .collect();
    format!(
        "#!/bin/sh\nexport PATH={}\n{exports}cd \"$HOME\"\n{}\n",
        quote(&launch.path()),
        command.join(" ")
    )
}

fn shell_name(name: &str) -> bool {
    let mut chars = name.chars();
    chars
        .next()
        .is_some_and(|first| first == '_' || first.is_ascii_alphabetic())
        && chars.all(|rest| rest == '_' || rest.is_ascii_alphanumeric())
}

fn quote(word: &str) -> String {
    format!("'{}'", word.replace('\'', r"'\''"))
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use serde_json::Value;

    use super::*;

    fn fake(body: &str) -> Launch {
        Launch {
            name: "Fake Agent".into(),
            program: "/bin/sh".into(),
            args: vec!["-c".into(), body.into()],
            env: BTreeMap::new(),
        }
    }

    fn answer(id: u32, result: Value) -> String {
        format!(
            "echo '{}'",
            json!({ "jsonrpc": "2.0", "id": id, "result": result })
        )
    }

    fn model_option() -> Value {
        json!({
            "id": "model", "name": "Model", "category": "model", "type": "select", "currentValue": "opus",
            "options": [{ "value": "opus", "name": "Opus" }, { "value": "haiku", "name": "Haiku" }],
        })
    }

    #[test]
    fn an_agent_that_previews_its_options_offers_its_models_before_any_conversation() {
        let dir = tempfile::tempdir().unwrap();
        let init = json!({
            "protocolVersion": 1,
            "agentCapabilities": {
                "promptCapabilities": { "image": true },
                "sessionCapabilities": { "options": {} },
            },
            "authMethods": [{ "id": "login", "name": "Log in", "type": "terminal", "args": ["login"] }],
        });
        let launch = fake(&format!(
            "read l; {}; read l; {}",
            answer(1, init),
            answer(2, json!({ "configOptions": [model_option()] }))
        ));

        let prepared = prepare(&launch, dir.path()).unwrap();

        assert!(prepared.images);
        assert!(!prepared.needs_sign_in);
        let models = prepared.models.unwrap();
        assert_eq!(models.id, "model");
        assert_eq!(models.current.as_deref(), Some("opus"));
        assert_eq!(models.choices.len(), 2);
        assert_eq!(prepared.efforts, None);
        assert_eq!(prepared.sign_in[0].id, "login");
    }

    #[test]
    fn an_agent_that_refuses_to_preview_until_signed_in_asks_for_a_sign_in() {
        let dir = tempfile::tempdir().unwrap();
        let init = json!({
            "protocolVersion": 1,
            "agentCapabilities": { "sessionCapabilities": { "options": {} } },
            "authMethods": [{ "id": "chat-gpt", "name": "ChatGPT" }],
        });
        let launch = fake(&format!(
            "read l; {}; read l; echo '{}'",
            answer(1, init),
            json!({ "jsonrpc": "2.0", "id": 2, "error": { "code": -32000, "message": "Authentication required" } })
        ));

        let prepared = prepare(&launch, dir.path()).unwrap();

        assert!(prepared.needs_sign_in);
        assert_eq!(prepared.models, None);
    }

    #[test]
    fn signing_in_through_the_agent_waits_for_it_to_authenticate() {
        let dir = tempfile::tempdir().unwrap();
        let init = json!({
            "protocolVersion": 1,
            "agentCapabilities": {},
            "authMethods": [{ "id": "chat-gpt", "name": "ChatGPT" }],
        });
        let launch = fake(&format!(
            "read l; {}; read l; printf '%s' \"$l\" > sent; {}",
            answer(1, init),
            answer(2, json!({}))
        ));

        let signed = sign_in(&launch, dir.path(), "chat-gpt").unwrap();

        let sent: Value =
            serde_json::from_str(&fs::read_to_string(dir.path().join("sent")).unwrap()).unwrap();
        assert_eq!(signed, SignIn::Done);
        assert_eq!(sent["method"], "authenticate");
        assert_eq!(sent["params"]["methodId"], "chat-gpt");
    }

    #[test]
    fn a_terminal_sign_in_runs_the_agent_with_the_methods_arguments_and_variables() {
        let launch = Launch {
            name: "Claude Agent".into(),
            program: "/Apps/agent dir/claude-agent-acp".into(),
            args: vec!["--acp".into()],
            env: BTreeMap::from([
                ("MODE".into(), "acp".into()),
                ("bad name".into(), "x".into()),
            ]),
        };
        let method: AuthMethod = serde_json::from_value(json!({
            "id": "claude-ai-login",
            "name": "Claude Subscription",
            "type": "terminal",
            "args": ["--cli", "it's"],
            "env": { "MODE": "login" },
        }))
        .unwrap();

        let script = terminal_script(&launch, &method);

        let lines: Vec<&str> = script.lines().collect();
        assert_eq!(lines[0], "#!/bin/sh");
        assert!(lines[1].starts_with("export PATH='/Apps/agent dir:"));
        assert_eq!(lines[2..4], ["export MODE='acp'", "export MODE='login'"]);
        assert_eq!(
            lines.last().unwrap(),
            &r#"'/Apps/agent dir/claude-agent-acp' '--acp' '--cli' 'it'\''s'"#
        );
        assert!(!script.contains("bad name"));
    }
}
