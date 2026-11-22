mod claude_code;
mod codex;
mod mastra_code;
mod omp;
mod pencil;

use std::path::Path;

use rusqlite::{Connection, OpenFlags};

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, serde::Serialize, serde::Deserialize,
)]
#[serde(rename_all = "kebab-case")]
pub enum Agent {
    ClaudeCode,
    Codex,
    Omp,
    MastraCode,
    Pencil,
}

impl Agent {
    pub fn name(self) -> &'static str {
        match self {
            Self::ClaudeCode => "Claude Code",
            Self::Codex => "Codex",
            Self::Omp => "omp",
            Self::MastraCode => "Mastra Code",
            Self::Pencil => "Pencil",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserPrompt {
    pub agent: Agent,
    pub session: String,
    pub project: Option<String>,
    pub at_ms: i64,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Unreadable {
    pub agent: Agent,
    pub reason: String,
}

pub struct Collected {
    pub prompts: Vec<UserPrompt>,
    pub unreadable: Vec<Unreadable>,
}

#[derive(Debug, thiserror::Error)]
enum SourceError {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Sqlite(#[from] rusqlite::Error),
}

type Read = fn(&Path) -> Result<Vec<UserPrompt>, SourceError>;

const READERS: [(Agent, Read); 5] = [
    (Agent::ClaudeCode, claude_code::read),
    (Agent::Codex, codex::read),
    (Agent::Omp, omp::read),
    (Agent::MastraCode, mastra_code::read),
    (Agent::Pencil, pencil::read),
];

pub fn supported() -> impl Iterator<Item = Agent> {
    READERS.into_iter().map(|(agent, _)| agent)
}

pub fn collect(home: &Path) -> Collected {
    let mut prompts = Vec::new();
    let mut unreadable = Vec::new();
    for (agent, read) in READERS {
        match read(home) {
            Ok(mut found) => prompts.append(&mut found),
            Err(error) => unreadable.push(Unreadable {
                agent,
                reason: error.to_string(),
            }),
        }
    }
    Collected {
        prompts: super::clean::clean(prompts),
        unreadable,
    }
}

fn open_read_only(path: &Path) -> rusqlite::Result<Connection> {
    Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
}

fn non_empty(value: Option<String>) -> Option<String> {
    value.filter(|value| !value.trim().is_empty())
}

fn parse_iso_ms(value: &str) -> Option<i64> {
    let bytes = value.as_bytes();
    let number = |range: std::ops::Range<usize>| -> Option<i64> {
        let digits = value.get(range)?;
        if !digits.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        digits.parse().ok()
    };
    if bytes.len() < 19 || bytes[4] != b'-' || bytes[7] != b'-' || bytes[13] != b':' {
        return None;
    }
    if !matches!(bytes[10], b'T' | b' ') || bytes[16] != b':' {
        return None;
    }
    let (year, month, day) = (number(0..4)?, number(5..7)?, number(8..10)?);
    let (hour, minute, second) = (number(11..13)?, number(14..16)?, number(17..19)?);
    let mut rest = &value[19..];
    let mut millis = 0;
    if let Some(fraction) = rest.strip_prefix('.') {
        let digits = fraction.bytes().take_while(u8::is_ascii_digit).count();
        let padded = format!("{:0<3}", &fraction[..digits.min(3)]);
        millis = padded.parse::<i64>().ok()?;
        rest = &fraction[digits..];
    }
    let offset_minutes = match rest {
        "" | "Z" => 0,
        _ => {
            let sign = match rest.as_bytes()[0] {
                b'+' => 1,
                b'-' => -1,
                _ => return None,
            };
            let hours = rest.get(1..3)?.parse::<i64>().ok()?;
            let minutes = rest.get(4..6)?.parse::<i64>().ok()?;
            sign * (hours * 60 + minutes)
        }
    };
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    let seconds = days_from_civil(year, month, day) * 86_400 + hour * 3_600 + minute * 60 + second
        - offset_minutes * 60;
    Some(seconds * 1_000 + millis)
}

fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let year_of_era = year - era * 400;
    let day_of_year = (153 * ((month + 9) % 12) + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_an_iso_utc_timestamp_with_milliseconds_as_epoch_ms() {
        assert_eq!(
            parse_iso_ms("2026-11-09T19:11:14.897Z"),
            Some(1_794_251_474_897)
        );
    }

    #[test]
    fn applies_the_timezone_offset_of_an_iso_timestamp() {
        assert_eq!(parse_iso_ms("1970-01-01T01:00:00+01:00"), Some(0));
        assert_eq!(parse_iso_ms("2000-03-01T00:00:00Z"), Some(951_868_800_000));
    }

    #[test]
    fn rejects_text_that_is_not_an_iso_timestamp() {
        assert_eq!(parse_iso_ms("yesterday"), None);
        assert_eq!(parse_iso_ms("2026-13-01T00:00:00Z"), None);
    }

    #[test]
    fn collecting_an_empty_home_finds_nothing_and_does_not_fail() {
        let home = tempfile::tempdir().unwrap();
        let collected = collect(home.path());
        assert!(collected.prompts.is_empty());
        assert!(collected.unreadable.is_empty());
    }

    #[test]
    fn reports_a_store_that_exists_but_cannot_be_read() {
        let home = tempfile::tempdir().unwrap();
        let store = home.path().join("Library/Application Support/mastracode");
        std::fs::create_dir_all(&store).unwrap();
        std::fs::write(store.join("mastra.db"), "not a database").unwrap();

        let unreadable = collect(home.path()).unreadable;

        assert_eq!(unreadable.len(), 1);
        assert_eq!(unreadable[0].agent, Agent::MastraCode);
    }
}
