"""Prepare OFL-licensed static Noto Sans SC fonts for the device UI."""
from pathlib import Path
from urllib.request import urlretrieve
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

root = Path(__file__).resolve().parents[1]
folder = root / '.tools' / 'fonts'
folder.mkdir(parents=True, exist_ok=True)
revision = 'a85815a42757630ce188fdad368c2dfc444d4773'
url = f'https://raw.githubusercontent.com/google/fonts/{revision}/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf'
variable = folder / 'NotoSansSC-VF.ttf'
urlretrieve(url, variable)
for style, weight in [('Regular', 400), ('Medium', 500), ('Bold', 700)]:
    font = instantiateVariableFont(TTFont(variable), {'wght': weight}, inplace=True)
    # These static derivatives use a distinct family name; upstream copyrights remain.
    for record in font['name'].names:
        if record.nameID in {1, 4, 6, 16}:
            value = 'MonitorSansSC' if record.nameID == 6 else 'Monitor Sans SC'
            font['name'].setName(value, record.nameID, record.platformID, record.platEncID, record.langID)
    font.save(folder / f'NotoSansSC_{style}.ttf')
    print(f'Prepared {style}', flush=True)
