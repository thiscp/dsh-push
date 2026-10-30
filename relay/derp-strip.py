#!/usr/bin/env python3
"""Strip a PROXY protocol header, then relay bytes to derper.

Why this exists
---------------
The edge nginx (stream, /root/edge/nginx.conf) sends `proxy_protocol on` to every
upstream so the HTTPS vhosts on 127.0.0.1:9443 can recover the real client IP.
derper does NOT understand PROXY protocol: it receives "PROXY TCP4 ..." where it
expects a TLS ClientHello and resets the connection. Since 2026-10-29 that broke
the DERP relay (clients: "could not connect to the Aliyun China relay server").

nginx cannot switch proxy_protocol per upstream, so this tiny relay sits between
the edge and derper: it consumes the PROXY header and pipes the raw TCP stream
to derper on 127.0.0.1:4430.

ASCII only. No third-party deps.
"""

import socket
import struct
import sys
import threading

LISTEN = ("127.0.0.1", 4431)
TARGET = ("127.0.0.1", 4430)

V2_SIG = b"\r\n\r\n\x00\r\nQUIT\n"
V1_MAX = 107  # spec: header line must not exceed 107 bytes including CRLF


def read_exact(sock, n):
    buf = b""
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise EOFError("peer closed while reading header")
        buf += chunk
    return buf


def consume_proxy_header(sock):
    """Return ('v1'|'v2'|'none') after removing any PROXY header from sock."""
    head = sock.recv(12, socket.MSG_PEEK)
    if not head:
        raise EOFError("peer closed before sending anything")

    if head.startswith(V2_SIG):
        fixed = read_exact(sock, 16)
        length = struct.unpack("!H", fixed[14:16])[0]
        if length:
            read_exact(sock, length)  # address block + TLVs
        return "v2"

    if head.startswith(b"PROXY "):
        line = b""
        while not line.endswith(b"\r\n"):
            if len(line) > V1_MAX:
                raise ValueError("PROXY v1 header too long")
            chunk = sock.recv(1)
            if not chunk:
                raise EOFError("peer closed inside PROXY v1 header")
            line += chunk
        return "v1"

    return "none"


def pump(src, dst):
    try:
        while True:
            data = src.recv(65536)
            if not data:
                break
            dst.sendall(data)
    except OSError:
        pass
    finally:
        try:
            dst.shutdown(socket.SHUT_WR)
        except OSError:
            pass


def handle(client):
    upstream = None
    try:
        client.settimeout(10)
        kind = consume_proxy_header(client)
        client.settimeout(None)
        upstream = socket.create_connection(TARGET, timeout=10)
        upstream.settimeout(None)
        if kind != "none":
            sys.stderr.write("stripped PROXY %s header\n" % kind)
            sys.stderr.flush()
        t = threading.Thread(target=pump, args=(upstream, client), daemon=True)
        t.start()
        pump(client, upstream)
        t.join(timeout=30)
    except Exception as exc:  # noqa: BLE001 - one bad client must not kill the relay
        sys.stderr.write("conn error: %r\n" % (exc,))
        sys.stderr.flush()
    finally:
        for s in (client, upstream):
            if s is None:
                continue
            try:
                s.close()
            except OSError:
                pass


def main():
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(LISTEN)
    srv.listen(128)
    sys.stderr.write("derp-strip listening on %s:%d -> %s:%d\n" % (LISTEN + TARGET))
    sys.stderr.flush()
    while True:
        client, _ = srv.accept()
        threading.Thread(target=handle, args=(client,), daemon=True).start()


if __name__ == "__main__":
    main()
