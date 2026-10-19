#!/usr/bin/env python3
# dsh-provd - tiny self-service pass issuer for the dsh-push relay.
#
# Why this exists: on our ntfy 2.29.0 build the access-token HTTP API is NOT compiled in
# (grep -a -c /v1/tokens /usr/bin/ntfy == 0; every /v1/tokens verb falls through to the topic
# publish handler), and POST /v1/users silently IGNORES topic grants. So issuing a per-person
# pass (topic + read-only token + write-only token) can only be done with the ntfy CLI on the
# server. This service is the one thin, authenticated HTTP wrapper around that CLI so a plugin
# install anywhere can self-serve without an ssh key on the relay.
#
# Listens on 127.0.0.1:2588 (2587 is taken by an unrelated long-lived python3 on this host); the edge nginx exposes it as https://ntfy.cpyh.xyz/provision/*
# (proxy_pass strips the /provision/ prefix, so paths here are /issue /list /revoke /healthz).
# Auth: Authorization: Bearer <secret from /etc/dsh-provd/secret, mode 600>.
# Every ntfy call is an argv list (never a shell string) - names come from the request body.


import json
import os
import re
import secrets
import subprocess
import threading
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn


SECRET_FILE = '/etc/dsh-provd/secret'
ADMIN_TOKEN_FILE = '/etc/dsh-provd/admin-token'
NTFY_LOCAL = 'http://127.0.0.1:2586'
BIND = ('127.0.0.1', 2588)
NAME_RE = re.compile(r'^[a-z0-9][a-z0-9-]{1,30}$')
MAX_BODY = 4096
CMD_TIMEOUT = 25


def read_file(path):
    try:
        with open(path) as f:
            return f.read().strip()
    except OSError:
        return ''


def admin_token():
    # /root/provision-token.txt holds 'token tk_xxx created for user ...' - take field 2
    raw = read_file(ADMIN_TOKEN_FILE)
    if raw.startswith('tk_'):
        return raw
    parts = raw.split()
    return parts[1] if len(parts) > 1 and parts[1].startswith('tk_') else ''


def ntfy(*args, **kw):
    env = None
    pw = kw.get('password')
    argv = ['docker', 'exec']
    if pw:
        argv += ['-e', 'NTFY_PASSWORD=' + pw]
    argv += ['ntfy', 'ntfy']
    argv += list(args)
    try:
        p = subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=CMD_TIMEOUT, env=env)
        return p.returncode, p.stdout.decode('utf-8', 'replace').strip()
    except Exception as e:  # noqa: BLE001 - report, never crash the service
        return 125, 'exec failed: %s' % e


def users_via_api():
    tok = admin_token()
    if not tok:
        return None, 'admin token missing'
    req = urllib.request.Request(NTFY_LOCAL + '/v1/users', headers={'Authorization': 'Bearer ' + tok})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read().decode('utf-8', 'replace')), None
    except Exception as e:  # noqa: BLE001
        return None, 'users api: %s' % e


def issue(name):
    phone, pub = name + '-phone', name + '-pub'
    known, err = users_via_api()
    if known is None:
        return 502, {'error': err}
    names = {u.get('username') for u in known}
    if phone in names or pub in names:
        return 409, {'error': 'name already issued', 'name': name}
    out = {}
    for user in (phone, pub):
        rc, msg = ntfy('user', 'add', user, password=secrets.token_urlsafe(24))
        if rc != 0:
            return 500, {'error': 'user add failed', 'user': user, 'detail': msg, 'rolled_back': rollback(name, out)}
    rc, msg = ntfy('access', phone, name, 'read-only')
    if rc != 0:
        return 500, {'error': 'grant phone failed', 'detail': msg}
    rc, msg = ntfy('access', pub, name, 'write-only')
    if rc != 0:
        return 500, {'error': 'grant pub failed', 'detail': msg}
    for key, user in (('readToken', phone), ('writeToken', pub)):
        rc, msg = ntfy('token', 'add', '-l', 'dsh-provd', user)
        tok = msg.split()[1] if len(msg.split()) > 1 and msg.split()[1].startswith('tk_') else ''
        if rc != 0 or not tok:
            return 500, {'error': 'token add failed', 'user': user, 'detail': msg}
        out[key] = tok
    return 200, {'topic': name, 'phoneUser': phone, 'pubUser': pub,
                'readToken': out['readToken'], 'writeToken': out['writeToken']}


def rollback(name, out):
    # best effort: drop whatever half-created users we made
    for user in (name + '-phone', name + '-pub'):
        ntfy('user', 'del', user)
    return True


def revoke(name):
    deleted, missing = [], []
    for user in (name + '-phone', name + '-pub'):
        rc, msg = ntfy('user', 'del', user)
        (deleted if rc == 0 else missing).append(user)
    if not deleted:
        return 404, {'error': 'nothing to revoke', 'name': name, 'detail': ' ; '.join(missing)}
    return 200, {'revoked': deleted, 'missing': missing}


def listing():
    known, err = users_via_api()
    if known is None:
        return 502, {'error': err}
    agg = {}
    for u in known:
        un = u.get('username') or ''
        if un in ('*', 'dsh-provision') or not un:
            continue
        base = re.sub(r'-(phone|pub)$', '', un)
        e = agg.setdefault(base, {'name': base, 'users': [], 'topics': []})
        e['users'].append(un)
        for g in (u.get('grants') or []):
            e['topics'].append({'topic': g.get('topic'), 'permission': g.get('permission'), 'user': un})
    return 200, {'passes': sorted(agg.values(), key=lambda x: x['name'])}


class H(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'


    def log_message(self, fmt, *a):
        # never log bodies (they carry tokens)
        super().log_message('%s %s', self.command, self.path.split('?')[0])


    def _send(self, code, obj):
        body = json.dumps(obj).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)


    def _authed(self):
        secret = read_file(SECRET_FILE)
        if not secret:
            return False
        got = self.headers.get('Authorization', '')
        return secrets.compare_digest(got, 'Bearer ' + secret)


    def do_GET(self):
        p = self.path.split('?')[0]
        if p == '/healthz':
            self._send(200, {'ok': True})
            return
        if not self._authed():
            self._send(401, {'error': 'unauthorized'})
            return
        if p == '/list':
            code, obj = listing()
            self._send(code, obj)
            return
        self._send(404, {'error': 'not found'})


    def do_POST(self):
        if not self._authed():
            self._send(401, {'error': 'unauthorized'})
            return
        p = self.path.split('?')[0]
        if p not in ('/issue', '/revoke'):
            self._send(404, {'error': 'not found'})
            return
        try:
            n = min(int(self.headers.get('Content-Length') or 0), MAX_BODY)
            data = json.loads(self.rfile.read(n).decode('utf-8') or '{}')
        except Exception:
            self._send(400, {'error': 'bad json'})
            return
        name = str(data.get('name') or '').strip()
        if not NAME_RE.match(name):
            self._send(400, {'error': 'bad name', 'rule': '^[a-z0-9][a-z0-9-]{1,30}$'})
            return
        code, obj = (issue(name) if p == '/issue' else revoke(name))
        self._send(code, obj)


class Srv(ThreadingMixIn, HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == '__main__':
    if not read_file(SECRET_FILE):
        raise SystemExit('missing secret file: ' + SECRET_FILE)
    Srv(BIND, H).serve_forever()
