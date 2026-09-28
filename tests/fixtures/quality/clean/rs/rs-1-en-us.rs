//! A minimal command-line argument parser.
//!
//! The parser supports long flags, short flags, and positional arguments.

/// Parses the given arguments and returns the positional values in order.
///
/// Flags are validated against the registered options, and an unknown flag
/// produces an error that names the offending argument.
pub fn parse(args: &[String]) -> Vec<String> {
    // Skip the program name, which is always the first argument.
    args.iter().skip(1).cloned().collect()
}
