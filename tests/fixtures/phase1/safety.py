"""Module résumé 😀 prose.

>>> print("protected doctest")
"""

value = """This non-docstring string is protected."""

def example():
    """Function documentation prose."""
    # Eligible comment prose.
    return value

def escaped():
    """An escaped docstring is skipped: \N{SNOWMAN}."""
