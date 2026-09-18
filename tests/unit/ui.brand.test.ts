import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Brand palette: sky #3FC9FC, navy #000E29, white #FFFFFF, and rgba() of exactly these.
const ALLOWED_HEX = new Set(['#3fc9fc', '#000e29', '#ffffff', '#fff']);
const ALLOWED_RGB = new Set(['63,201,252', '0,14,41', '255,255,255']);
const ALLOWED_WORDS = new Set(['transparent', 'currentcolor', 'inherit', 'none', 'white']);
// Every CSS named colour (CSS Color 4) except the allowed ones above.
const NAMED =
  'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat whitesmoke yellow yellowgreen'.split(
    ' ',
  );
const NAMED_RE = new RegExp(`(^|[^a-z-])(${NAMED.join('|')})(?![a-z-])`, 'i');

/** Returns every colour in the CSS that is not a brand colour. */
function brandViolations(css: string): string[] {
  const bad: string[] = [];
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const decl = /([a-z-]+)\s*:\s*([^;{}]+)[;}]/gi;
  for (const m of noComments.matchAll(decl)) {
    const prop = m[1];
    const value = m[2].replace(/var\(--[a-z0-9-]+\)/gi, 'var()').replace(/url\([^)]*\)/gi, 'url()');
    for (const hex of value.match(/#[0-9a-f]{3,8}\b/gi) ?? []) {
      if (!ALLOWED_HEX.has(hex.toLowerCase())) bad.push(`${prop}: ${hex}`);
    }
    for (const fn of value.matchAll(/\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(([^)]*)\)/gi)) {
      const name = fn[1].toLowerCase();
      if (name !== 'rgb' && name !== 'rgba') {
        bad.push(`${prop}: ${fn[0]}`);
        continue;
      }
      const parts = fn[2].split(/[\s,/]+/).filter(Boolean);
      if (!ALLOWED_RGB.has(parts.slice(0, 3).join(','))) bad.push(`${prop}: ${fn[0]}`);
    }
    if (
      !prop.startsWith('--') &&
      !['font-family', 'animation', 'animation-name', 'grid-template-columns'].includes(prop)
    ) {
      const w = NAMED_RE.exec(value);
      if (w && !ALLOWED_WORDS.has(w[2].toLowerCase())) bad.push(`${prop}: ${w[2]}`);
    }
  }
  return bad;
}

const root = join(__dirname, '..', '..');

describe('brand colours', () => {
  it('the checker catches off-brand colours', () => {
    expect(brandViolations('a{color:red}')).toEqual(['color: red']);
    expect(brandViolations('a{background:#ff0000;}')).toEqual(['background: #ff0000']);
    expect(brandViolations('a{border:1px solid rgba(0, 0, 0, 0.5);}')).toHaveLength(1);
    expect(brandViolations('a{fill:hsl(10 50% 50%);}')).toHaveLength(1);
    expect(brandViolations('a{background:linear-gradient(90deg, #3fc9fc, green);}')).toEqual(['background: green']);
    expect(brandViolations('a{color:#3FC9FC;background:rgba(0,14,41,.8);border-color:#fff}')).toEqual([]);
  });

  it('styles.css uses only #3FC9FC, #000E29, #FFFFFF and rgba of them', () => {
    const css = readFileSync(join(root, 'src', 'ui', 'styles.css'), 'utf8');
    expect(css.length).toBeGreaterThan(1000);
    expect(brandViolations(css)).toEqual([]);
  });

  it('UI and input code set no inline colours', () => {
    const files = ['src/ui', 'src/input'].flatMap((d) =>
      readdirSync(join(root, d))
        .filter((f) => f.endsWith('.ts'))
        .map((f) => join(root, d, f)),
    );
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect(src.match(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b(?![0-9a-z])|\brgba?\(/gi) ?? [], f).toEqual([]);
    }
  });
});
