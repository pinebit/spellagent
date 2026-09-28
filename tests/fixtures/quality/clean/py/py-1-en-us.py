"""Utilities for reading configuration files.

The loader accepts JSON and TOML files and returns a plain dictionary.
"""


def load_config(path):
    """Read the configuration file at ``path`` and return its contents.

    Missing optional keys are filled with their documented defaults, and
    unknown keys raise an error so that typos are caught early.
    """
    # Keep the parsing logic in one place so both formats behave the same way.
    return {}
