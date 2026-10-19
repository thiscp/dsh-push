# insert the /provision/ location into the ntfy server block; abort unless the anchor is unique
import glob
import os
import sys
import time


P = '/root/edge/conf.d/edge-http.conf'
ANCHOR = '    location / {\n        proxy_pass http://127.0.0.1:2586;'
BLOCK = '\n'.join([
    '    location /provision/ {',
    '        proxy_pass http://127.0.0.1:2588/;',
    '        proxy_http_version 1.1;',
    "        proxy_set_header Host $host;",
    '        proxy_set_header X-Real-IP $remote_addr;',
    '        proxy_set_header X-Forwarded-Proto https;',
    '        proxy_read_timeout 30s;',
    '    }',
    '',
    ANCHOR,
])


s = open(P).read()
if '/provision/' in s:
    print('already present - nothing to do')
    sys.exit(0)
n = s.count(ANCHOR)
print('anchor count =', n)
if n != 1:
    sys.exit('anchor not unique - file untouched')
bak = P + '.bak-provision-' + time.strftime('%Y%m%d-%H%M%S')
with open(bak, 'w') as f:
    f.write(s)
print('backup:', bak)
with open(P, 'w') as f:
    f.write(s.replace(ANCHOR, BLOCK))
print('inserted')
