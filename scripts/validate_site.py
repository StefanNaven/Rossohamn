"""Dependency-free static checks (not a complete HTML standards validator)."""
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit, unquote
import sys
root=Path(__file__).resolve().parents[1]
class Page(HTMLParser):
 def __init__(self):super().__init__(convert_charrefs=True);self.ids=set();self.refs=[];self.errors=[];self.lang=False;self.h1=0
 def handle_starttag(self,tag,attrs):
  a=dict(attrs)
  if tag=='html':self.lang=bool(a.get('lang'))
  if tag=='h1':self.h1+=1
  if 'id' in a:
   if a['id'] in self.ids:self.errors.append(f'duplicate id {a["id"]}')
   self.ids.add(a['id'])
  for key in ('href','src','for'):
   if key in a:self.refs.append((key,a[key]))
errors=[];pages={}
for file in root.rglob('*.html'):
 if any(p.startswith('.') or p=='node_modules' for p in file.relative_to(root).parts):continue
 p=Page();p.feed(file.read_text(encoding='utf-8'));pages[file]=p
 if not p.lang:errors.append(f'{file.relative_to(root)}: missing lang')
 if p.h1!=1:errors.append(f'{file.relative_to(root)}: expected exactly one h1')
 errors.extend(f'{file.relative_to(root)}: {e}' for e in p.errors)
for file,page in pages.items():
 for attr,ref in page.refs:
  if attr=='for':
   if ref not in page.ids:errors.append(f'{file.relative_to(root)}: unknown label target {ref}')
   continue
  u=urlsplit(ref)
  if u.scheme or u.netloc:continue
  path=unquote(u.path);target=(root/path.lstrip('/') if path.startswith('/') else file.parent/path).resolve() if path else file
  if target.is_dir():target=target/'index.html'
  if not target.is_file():errors.append(f'{file.relative_to(root)}: missing target {ref}');continue
  if u.fragment and target in pages and u.fragment not in pages[target].ids:errors.append(f'{file.relative_to(root)}: missing fragment {ref}')
if errors:print('\n'.join(errors));sys.exit(1)
print(f'{len(pages)} HTML pages checked: IDs, labels and internal links OK')
