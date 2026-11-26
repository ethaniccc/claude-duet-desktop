"""Makes fonts/apple-emoji.ttf, a copy of Apple Color Emoji that the app can show, from the font file of a Mac.

Usage: python scripts/apple-emoji.py "Apple Color Emoji.ttc"
Needs: python -m pip install fonttools uharfbuzz pillow
"""

import io
import sys
import urllib.request
from pathlib import Path

import uharfbuzz as hb
from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
from fontTools.ttLib import TTCollection, TTFont
from fontTools.ttLib.tables._c_m_a_p import CmapSubtable
from fontTools.ttLib.tables._g_l_y_f import Glyph
from PIL import Image

TARGET = Path(__file__).resolve().parent.parent / 'fonts' / 'apple-emoji.ttf'
EMOJI_TEST_URL = 'https://unicode.org/Public/emoji/latest/emoji-test.txt'
# Chromium refuses web fonts over 128 MB, and the Mac file has every emoji at nine sizes. 64 px is sharp at the sizes the chat shows.
IMAGE_SIZE = 64
APPLE_ONLY_TABLES = ('morx', 'feat', 'trak', 'bgcl', 'cntr')
HIDDEN_GLYPHS = ('ZWJ', 'uniFE0F')


def emoji_sequences():
    with urllib.request.urlopen(EMOJI_TEST_URL, timeout=60) as response:
        lines = response.read().decode('utf-8').splitlines()
    for line in lines:
        fields = line.split(';')
        if len(fields) < 2 or line.startswith('#'):
            continue
        codepoints = [int(value, 16) for value in fields[0].split()]
        if len(codepoints) > 1:
            yield codepoints


def shaper(path):
    font = hb.Font(hb.Face(hb.Blob.from_file_path(str(path)), 0))
    order = TTFont(path, fontNumber=0, lazy=True).getGlyphOrder()

    def shape(codepoints):
        buffer = hb.Buffer()
        buffer.add_codepoints(codepoints)
        buffer.guess_segment_properties()
        hb.shape(font, buffer)
        glyphs = [(order[info.codepoint], position) for info, position in zip(buffer.glyph_infos, buffer.glyph_positions)]
        # HarfBuzz shows leftover joiners and selectors as a zero-width space, which Chromium hides by itself.
        return [(name, (position.x_advance, position.x_offset, position.y_offset)) for name, position in glyphs if name != 'space']

    return shape


def keep_one_size(font):
    strikes = font['sbix'].strikes
    if IMAGE_SIZE not in strikes:
        sys.exit('The font has no %d px images. It has: %s' % (IMAGE_SIZE, sorted(strikes)))
    for size in list(strikes):
        if size != IMAGE_SIZE:
            del strikes[size]


# Apple draws some emoji, such as the people facing right, as a mirror of another glyph, which Chromium cannot do.
def mirror_flipped_images(font):
    images = font['sbix'].strikes[IMAGE_SIZE].glyphs
    for image in images.values():
        if image.graphicType == 'flip':
            source = images[image.referenceGlyphName]
            mirrored = io.BytesIO()
            Image.open(io.BytesIO(source.imageData)).transpose(Image.Transpose.FLIP_LEFT_RIGHT).save(mirrored, 'PNG', optimize=True)
            image.graphicType = 'png '
            image.imageData = mirrored.getvalue()
            image.originOffsetX = source.originOffsetX
            image.originOffsetY = source.originOffsetY
            del image.referenceGlyphName


# Chromium ignores Apple's morx table, which joins sequences such as flags, skin tones and families, so the joins are written again as GSUB.
# HarfBuzz can read morx, so each sequence Unicode lists is shaped with the original font to find the glyphs it becomes.
def write_joins(font, sequences, shape):
    # A copy, because the cmap tables are changed below.
    cmap = dict(font.getBestCmap())
    joins = {}
    splits = {}
    for codepoints in sequences:
        if any(codepoint not in cmap for codepoint in codepoints):
            continue
        components = tuple(cmap[codepoint] for codepoint in codepoints)
        output = [name for name, _ in shape(codepoints)]
        if components in joins or output == [name for name in components if name not in HIDDEN_GLYPHS]:
            continue
        if len(output) == 1:
            joins[components] = output[0]
        else:
            # A GSUB ligature makes one glyph, so a sequence drawn as two glyphs first becomes an empty glyph, which a second lookup splits.
            placeholder = 'seq%d' % len(splits)
            joins[components] = placeholder
            splits[placeholder] = output

    # A symbol such as ↔ or ♥ is text unless FE0F follows it. On its own it maps to an empty glyph that becomes .notdef, so the browser draws it with the next font.
    # With FE0F, a variation sequence maps it to the emoji, and a joiner or skin tone next to it brings the emoji back too.
    text_style = sorted({codepoints[0] for codepoints in sequences if len(codepoints) == 2 and codepoints[1] == 0xFE0F and codepoints[0] in cmap})
    emoji_glyphs = [cmap[codepoint] for codepoint in text_style]
    text_glyphs = [name + '.text' for name in emoji_glyphs]
    variations = CmapSubtable.newSubtable(14)
    variations.platformID, variations.platEncID, variations.language, variations.cmap = 0, 5, 0xFF, {}
    variations.uvsDict = {0xFE0F: [(codepoint, cmap[codepoint]) for codepoint in text_style]}
    for table in font['cmap'].tables:
        if table.isUnicode():
            table.cmap.update({codepoint: name + '.text' for codepoint, name in zip(text_style, emoji_glyphs) if codepoint in table.cmap})
    font['cmap'].tables.append(variations)
    order = font.getGlyphOrder() + list(splits) + text_glyphs
    font.setGlyphOrder(order)
    for placeholder in list(splits) + text_glyphs:
        font['glyf'].glyphs[placeholder] = Glyph()
        font['hmtx'][placeholder] = (0, 0)
        font['vmtx'][placeholder] = (0, 0)

    emoji_marks = ' '.join(cmap[codepoint] for codepoint in [0x200D, *range(0x1F3FB, 0x1F400)])
    lines = ['languagesystem DFLT dflt;']
    lines += ['lookup restore { sub [%s] by [%s]; } restore;' % (' '.join(text_glyphs), ' '.join(emoji_glyphs)), 'lookup hide { sub [%s] by .notdef; } hide;' % ' '.join(text_glyphs)]
    lines += ['lookup text_style {', "    sub [%s]' lookup restore [%s];" % (' '.join(text_glyphs), emoji_marks), "    sub ZWJ [%s]' lookup restore;" % ' '.join(text_glyphs), "    sub [%s]' lookup hide;" % ' '.join(text_glyphs), '} text_style;']
    lines += ['lookup joins {']
    lines += ['    sub %s by %s;' % (' '.join(components), glyph) for components, glyph in joins.items()]
    lines += ['} joins;', 'lookup splits {']
    lines += ['    sub %s by %s;' % (placeholder, ' '.join(output)) for placeholder, output in splits.items()]
    lines += ['} splits;', 'feature ccmp {', '    lookup text_style;', '    lookup joins;', '    lookup splits;', '} ccmp;']
    # Only GSUB is built, because the font's own GDEF marks the right half of a pair, which its GPOS then draws over the left half.
    addOpenTypeFeaturesFromString(font, '\n'.join(lines), tables=['GSUB'])
    return len(joins)


def main(source):
    if not Path(source).is_file():
        sys.exit('No font file at %s' % source)
    sequences = list(emoji_sequences())
    font = TTCollection(source).fonts[0]
    keep_one_size(font)
    mirror_flipped_images(font)
    original = shaper(source)
    joins = write_joins(font, sequences, original)
    for tag in APPLE_ONLY_TABLES:
        if tag in font:
            del font[tag]
    # Windows reads the line height from these, and Apple leaves them at zero.
    font['OS/2'].usWinAscent = font['hhea'].ascent
    font['OS/2'].usWinDescent = -font['hhea'].descent
    TARGET.parent.mkdir(exist_ok=True)
    font.save(TARGET)

    copy = shaper(TARGET)
    different = [codepoints for codepoints in sequences if original(codepoints) != copy(codepoints)]
    print('Wrote %s with %d joined sequences.' % (TARGET, joins))
    if different:
        print('%d of %d sequences come out different from the Mac font, for example %s.' % (len(different), len(sequences), ' '.join('%X' % c for c in different[0])))
    else:
        print('All %d sequences come out the same as on the Mac.' % len(sequences))


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
