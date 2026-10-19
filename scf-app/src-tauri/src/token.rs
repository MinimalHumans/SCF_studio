// SPDX-License-Identifier: Apache-2.0
//! Tokens for the loopback listeners: what a client must show to be
//! let in, so another user's program on the same machine is not.

/// 128 random bits, as hex.
pub fn new() -> std::io::Result<String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|e| std::io::Error::other(e.to_string()))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}
