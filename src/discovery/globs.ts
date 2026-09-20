const REGEX_SPECIAL = /[\\^$.*+?()[\]{}|]/u;

function expandBraces(pattern: string): string[] {
  const open = pattern.indexOf('{');
  if (open < 0) return [pattern];
  const close = pattern.indexOf('}', open + 1);
  if (close < 0) throw new Error(`Unclosed brace in glob: ${pattern}`);
  const choices = pattern.slice(open + 1, close).split(',');
  if (choices.some(choice => choice.length === 0)) throw new Error(`Empty brace choice in glob: ${pattern}`);
  return choices.flatMap(choice => expandBraces(`${pattern.slice(0, open)}${choice}${pattern.slice(close + 1)}`));
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
    if (pattern.startsWith('!') || pattern.startsWith('/') || pattern.includes('\\') || pattern.includes('\0')) {
      throw new Error(`Unsupported root-relative glob: ${pattern}`);
    }
    return { pattern, regexes: expandBraces(pattern).map(compileOne) };
  });
}

export function firstGlobMatch(path: string, globs: ReturnType<typeof compileGlobs>): string | undefined {
  return globs.find(glob => glob.regexes.some(regex => regex.test(path)))?.pattern;
}
