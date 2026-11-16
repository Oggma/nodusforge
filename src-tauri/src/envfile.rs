use std::collections::HashMap;
use std::path::Path;

/// Read a dotenv-style file. Missing or unreadable files yield an empty map.
pub fn read(path: &Path) -> HashMap<String, String> {
    std::fs::read_to_string(path)
        .map(|text| parse(&text))
        .unwrap_or_default()
}

/// Parse dotenv-style `KEY=VALUE` lines.
///
/// Supports `#` comments (whole-line and inline), an optional `export ` prefix,
/// and single-, double- and backtick-quoted values. Quoted values may contain
/// `#` and `:`; unquoted values keep `:` and only treat `#` as a comment when it
/// starts the value or follows whitespace.
pub fn parse(text: &str) -> HashMap<String, String> {
    let mut env = HashMap::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let line = line.strip_prefix("export ").unwrap_or(line);
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim();
        if key.is_empty() {
            continue;
        }
        env.insert(key.to_string(), parse_value(value));
    }
    env
}

fn parse_value(raw: &str) -> String {
    let value = raw.trim_start();
    match value.as_bytes().first().copied() {
        Some(quote @ (b'"' | b'\'' | b'`')) => quoted_value(&value[1..], quote),
        _ => unquoted_value(value),
    }
}

/// Read a quoted value up to its closing quote. Anything after the closing
/// quote (trailing whitespace or a comment) is ignored.
fn quoted_value(rest: &str, quote: u8) -> String {
    let mut out = String::with_capacity(rest.len());
    let double_quoted = quote == b'"';
    let mut chars = rest.chars();
    while let Some(ch) = chars.next() {
        if double_quoted && ch == '\\' {
            let Some(escaped) = chars.next() else {
                out.push('\\');
                break;
            };
            match escaped {
                'n' => out.push('\n'),
                'r' => out.push('\r'),
                't' => out.push('\t'),
                '\\' => out.push('\\'),
                '"' => out.push('"'),
                other => {
                    out.push('\\');
                    out.push(other);
                }
            }
            continue;
        }
        if ch == quote as char {
            break;
        }
        out.push(ch);
    }
    out
}

fn unquoted_value(raw: &str) -> String {
    let raw = raw.trim_end();
    let end = raw
        .char_indices()
        .find(|(index, ch)| {
            *ch == '#' && (*index == 0 || raw[..*index].ends_with(char::is_whitespace))
        })
        .map(|(index, _)| index)
        .unwrap_or(raw.len());
    raw[..end].trim_end().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_plain_and_exported_values() {
        let env = parse("A=1\nexport B=two\nC=three\n");

        assert_eq!(env["A"], "1");
        assert_eq!(env["B"], "two");
        assert_eq!(env["C"], "three");
    }

    #[test]
    fn keeps_colons_and_urls() {
        let env = parse("URL=http://localhost:42000/path?x=1\nTOKEN=a:b:c\n");

        assert_eq!(env["URL"], "http://localhost:42000/path?x=1");
        assert_eq!(env["TOKEN"], "a:b:c");
    }

    #[test]
    fn skips_whole_line_comments() {
        let env = parse("# heading\n  # indented\nA=1\n");

        assert_eq!(env.len(), 1);
        assert_eq!(env["A"], "1");
    }

    #[test]
    fn inline_comment_requires_whitespace_before_hash() {
        let env = parse("A=abc#def\nB=abc # trailing\nC=# only a comment\nD=   # comment\n");

        assert_eq!(env["A"], "abc#def");
        assert_eq!(env["B"], "abc");
        assert_eq!(env["C"], "");
        assert_eq!(env["D"], "");
    }

    #[test]
    fn parses_quoted_values() {
        let env = parse(concat!(
            "A=\"frame-ancestors 'self' http://localhost:42000\"  # note\n",
            "B='a # b: c'\n",
            "C=\"line\\nbreak\"\n",
            "D=\"escaped \\\"quote\\\"\"\n",
            "E=`literal # value`\n",
            "F=\"# not a comment\"\n",
        ));

        assert_eq!(env["A"], "frame-ancestors 'self' http://localhost:42000");
        assert_eq!(env["B"], "a # b: c");
        assert_eq!(env["C"], "line\nbreak");
        assert_eq!(env["D"], "escaped \"quote\"");
        assert_eq!(env["E"], "literal # value");
        assert_eq!(env["F"], "# not a comment");
    }

    #[test]
    fn handles_empty_values_and_whitespace() {
        let env = parse("EMPTY=\nSPACED = value   \n");

        assert_eq!(env["EMPTY"], "");
        assert_eq!(env["SPACED"], "value");
    }

    #[test]
    fn handles_crlf_lines() {
        let env = parse("A=1\r\nB=2\r\n");

        assert_eq!(env["A"], "1");
        assert_eq!(env["B"], "2");
    }

    #[test]
    fn ignores_malformed_lines() {
        let env = parse("NO_EQUALS\n=orphan\nVALID=1\n");

        assert_eq!(env.len(), 1);
        assert_eq!(env["VALID"], "1");
    }

    #[test]
    fn missing_file_is_empty() {
        assert!(read(Path::new("/nonexistent/nodusforge-test.env")).is_empty());
    }
}

