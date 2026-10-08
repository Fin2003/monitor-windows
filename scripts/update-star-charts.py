"""Keep only aggregate charts, show the current count and refresh README URLs."""
from pathlib import Path
import hashlib, json, os, re
root = Path(__file__).resolve().parent.parent
folder = root/'docs/star-history'
history = json.loads((folder/'history.json').read_text(encoding='utf-8'))
count = history['points'][-1]['count']
branch = os.environ.get('CHART_BRANCH', 'main')
for file in folder.glob('*.svg'):
    if file.name not in {'chart.svg', 'chart-dark.svg'}:
        file.unlink()
        continue
    svg = re.sub(r'<image\b[^>]*/>', '', file.read_text(encoding='utf-8'), flags=re.S)
    svg = re.sub(r'<text id="current-star-count".*?</text>\s*', '', svg, flags=re.S)
    ink = '#eeeeee' if file.name == 'chart-dark.svg' else '#222222'
    svg = svg.replace('</svg>', f'<text id="current-star-count" x="24" y="30" fill="{ink}" font-family="sans-serif" font-size="17">Stars: {count}</text>\n</svg>')
    svg = '\n'.join(line.rstrip() for line in svg.splitlines())+'\n'
    file.write_text(svg,encoding='utf-8')
    revision = hashlib.sha256(svg.encode()).hexdigest()[:16]
    address = f'https://raw.githubusercontent.com/Fin2003/monitor-windows/{branch}/docs/star-history/{file.name}?v={revision}'
    for name in ['README.md', 'README.en.md']:
        doc = root/name
        text = doc.read_text(encoding='utf-8')
        text = re.sub(r'(?<=")(?:https://raw\.githubusercontent\.com/Fin2003/monitor-windows/[^" ]*/)?docs/star-history/'+re.escape(file.name)+r'(?:\?v=[^" ]*)?(?=")', address, text)
        if 'img.shields.io/github/stars/Fin2003/monitor-windows' not in text:
            marker = '<picture>'
            text = text.replace(marker, '![GitHub Stars](https://img.shields.io/github/stars/Fin2003/monitor-windows?style=flat&label=Stars)\n\n'+marker)
        doc.write_text(text,encoding='utf-8')
print(f'Updated aggregate charts and README URLs: {count} stars, {branch}')
