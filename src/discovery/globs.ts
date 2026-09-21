const REGEX_SPECIAL = /[\\^$.*+?()[\]{}|]/u;

function expandBraces(pattern: string): string[] {
  if ((pattern.match(/\{/gu) ?? []).length > 4) throw new Error('Too many brace groups');
  let expanded = [''];
  let remaining = pattern;
  for (;;) {
    const open = remaining.indexOf('{');
    if (open < 0) {
      if (remaining.includes('}')) throw new Error('Unmatched closing brace');
      return expanded.map(prefix => prefix + remaining);
    }
    const literal = remaining.slice(0, open);
    const close = remaining.indexOf('}', open + 1);
    if (literal.includes('}') || close < 0 || remaining.slice(open + 1, close).includes('{')) {
      throw new Error('Unmatched or nested glob braces');
    }
    const choices = remaining.slice(open + 1, close).split(',');
    if (choices.length > 32 || choices.some(choice => choice.length === 0)) throw new Error('Invalid brace choices');
    // Bound the Cartesian product before allocating it.
    if (expanded.length * choices.length > 256) throw new Error('Too many glob alternatives');
    expanded = expanded.flatMap(prefix => choices.map(choice => prefix + literal + choice));
    remaining = remaining.slice(close + 1);
  }
}

function validatePattern(pattern: string) {
  if (pattern.startsWith('!') || pattern.startsWith('/') || pattern.includes('\\') ||
      /[:\u0000-\u001f\u007f]/u.test(pattern) || pattern.split('/').some(part => part === '..' || part === '.')) {
    throw new Error('Unsupported root-relative glob');
  }
}

function compileOne(pattern: string): RegExp {
  let source = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]!;
    if (character === '*') {
      if (pattern[index + 1] === '*') {
        index += 1;
        if (pattern[index + 1] === '/') {
          index += 1;
          source += '(?:.*/)?';
        } else source += '.*';
      } else source += '[^/]*';
    } else if (character === '?') source += '[^/]';
    else source += REGEX_SPECIAL.test(character) ? `\\${character}` : character;
  }
  return new RegExp(`${source}$`, 'u');
}

export function compileGlobs(patterns: readonly string[]): readonly { pattern: string; regexes: readonly RegExp[] }[] {
  return patterns.map(pattern => {
    validatePattern(pattern);
    const expanded = expandBraces(pattern);
    expanded.forEach(validatePattern);
    return { pattern, regexes: expanded.map(compileOne) };
  });
}

export function firstGlobMatch(path: string, globs: ReturnType<typeof compileGlobs>): string | undefined {
  return globs.find(glob => glob.regexes.some(regex => regex.test(path)))?.pattern;
}
