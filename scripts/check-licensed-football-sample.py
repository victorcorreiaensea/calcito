"""Inspect a small freely licensed historical reference; never write production data."""
import re
import urllib.request
from html.parser import HTMLParser
URL='https://en.wikipedia.org/wiki/2024%E2%80%9325_FC_Porto_season'
class Text(HTMLParser):
    def __init__(self): super().__init__(); self.parts=[]; self.skip=0
    def handle_starttag(self,tag,attrs):
        if tag in ('script','style'): self.skip+=1
        if tag in ('tr','td','th','div','p','br'): self.parts.append('\n')
    def handle_endtag(self,tag):
        if tag in ('script','style'): self.skip=max(0,self.skip-1)
    def handle_data(self,data):
        if not self.skip: self.parts.append(data)
try:
    request=urllib.request.Request(URL,headers={'User-Agent':'CalcitoImportTest/1.0 (read-only football reference)'})
    with urllib.request.urlopen(request,timeout=15) as response: content=response.read(2_000_000).decode('utf-8')
    parser=Text(); parser.feed(content)
    text=re.sub(r'[ \t]+',' ',''.join(parser.parts))
    excerpts=[]
    for needle in ('6 October 2024','10 November 2024','10 August 2024'):
        pos=text.find(needle)
        if pos>=0: excerpts.append(text[max(0,pos-70):pos+700])
    summary=URL+'\nLicense: Wikipedia CC BY-SA; reference only, no imports.\n'+ ('\n'.join(excerpts) or 'No dated fixture located in received page; no sample inferred.')
except Exception as error:
    summary=f'Historical reference unavailable: {type(error).__name__}; no sample inferred.'
print('::notice title=Licensed football sample::'+summary.replace('%','%25').replace('\r','%0D').replace('\n','%0A'))
