#!/usr/bin/env python3
# blog-dl-sync.py -- keep blog.cpyh.xyz's two download buttons pointing at the newest build.
#
#   npm dist-tags.latest             ->  /srv/blog/dl/dsh-push-host-latest.tgz  (+ dsh-push-host-<ver>.tgz)
#   /var/www/certbot/dl/dsh-push.apk ->  /srv/blog/dl/dsh-push-latest.apk
#
# Why this exists: the release scripts mirror these two files as a side step
# (verify/npm-publish-host.ps1 -> blog-mirror-host.ps1, verify/release-fast.ps1 step 3b),
# and that step is easy to skip: -SkipBlog, a hand-run "npm publish", a WARN nobody read.
# Since the page went latest-only there is no version number left to notice, so drift is
# invisible -- on 2026-11-02 the blog was quietly serving plugin 0.7.10 while npm was on
# 0.7.19, and app 1.34.5 while 1.34.6 was live. This job is the safety net: it converges
# no matter which path the release took.
#
# Install: /usr/local/bin/blog-dl-sync.py + /etc/cron.d/blog-dl-sync ("17 * * * * root ...")
# Log:     /var/log/blog-dl-sync.log, self-trimmed to the last 2000 lines.
# Python 3.6 safe (this box is AL8). No third-party imports.
import fcntl
import hashlib
import json
import os
import shutil
import sys
import tempfile
import time
import urllib.request

BLOG_DL = "/srv/blog/dl"
APK_SRC = "/var/www/certbot/dl/dsh-push.apk"
LOG = "/var/log/blog-dl-sync.log"
LOCK = "/var/run/blog-dl-sync.lock"
UA = "blog-dl-sync/1.0"
# npmjs first (it is the authority); npmmirror only as a fallback for CN reachability.
REGISTRIES = [
    ("npmjs", "https://registry.npmjs.org/dsh-push-host"),
    ("npmmirror", "https://registry.npmmirror.com/dsh-push-host"),
]

LINES = []


def log(msg):
    LINES.append("%s %s" % (time.strftime("%Y-%m-%dT%H:%M:%S%z"), msg))


def fetch(url, timeout=30, accept=None):
    headers = {"User-Agent": UA}
    if accept:
        headers["Accept"] = accept
    req = urllib.request.Request(url, headers=headers)
    resp = urllib.request.urlopen(req, timeout=timeout)
    return resp.read()


def file_hash(path, algo):
    h = hashlib.new(algo)
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def atomic_replace(dst, data=None, copy_from=None):
    """Write in the same directory, then os.replace: readers never see a partial file."""
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(dst), prefix=".tmp-blogdl-")
    try:
        if data is not None:
            with os.fdopen(fd, "wb") as fh:
                fh.write(data)
        else:
            os.close(fd)
            shutil.copyfile(copy_from, tmp)
        os.chmod(tmp, 0o644)
        os.replace(tmp, dst)
    except Exception:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def sync_tgz():
    meta = None
    src = None
    for name, url in REGISTRIES:
        try:
            meta = json.loads(fetch(url, 30, "application/vnd.npm.install-v1+json").decode("utf-8"))
            src = name
            break
        except Exception as exc:
            log("WARN registry %s unreachable: %s" % (name, exc))
    if meta is None:
        return "tgz=skipped(no registry)"
    ver = meta["dist-tags"]["latest"]
    dist = meta["versions"][ver]["dist"]
    want = dist["shasum"]
    latest = os.path.join(BLOG_DL, "dsh-push-host-latest.tgz")
    have = file_hash(latest, "sha1") if os.path.exists(latest) else None
    if have == want:
        return "tgz=%s up-to-date" % ver
    data = fetch(dist["tarball"], 120)
    got = hashlib.sha1(data).hexdigest()
    if got != want:
        return "ERROR tgz sha1 mismatch got=%s want=%s (%s)" % (got, want, ver)
    versioned = os.path.join(BLOG_DL, "dsh-push-host-%s.tgz" % ver)
    if not os.path.exists(versioned):
        atomic_replace(versioned, data=data)
    atomic_replace(latest, data=data)
    return "tgz=%s UPDATED %s -> %s (%d bytes, %s)" % (
        ver, (have or "missing")[:8], got[:8], len(data), src)


def sync_apk():
    dst = os.path.join(BLOG_DL, "dsh-push-latest.apk")
    if not os.path.exists(APK_SRC):
        return "apk=skipped(no %s)" % APK_SRC
    want = file_hash(APK_SRC, "sha256")
    have = file_hash(dst, "sha256") if os.path.exists(dst) else None
    if have == want:
        return "apk=up-to-date"
    atomic_replace(dst, copy_from=APK_SRC)
    return "apk=UPDATED %s -> %s (%d bytes)" % ((have or "missing")[:8], want[:8], os.path.getsize(dst))


def trim_log():
    try:
        with open(LOG, "rb") as fh:
            lines = fh.read().split(b"\n")
        if len(lines) > 2000:
            with open(LOG, "wb") as fh:
                fh.write(b"\n".join(lines[-2000:]))
    except Exception:
        pass


def main():
    if not os.path.isdir(BLOG_DL):
        log("ERROR %s missing, nothing to do" % BLOG_DL)
        return 1
    lock = open(LOCK, "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except IOError:
        log("skipped: another run holds the lock")
        return 0
    try:
        log("%s | %s" % (sync_tgz(), sync_apk()))
    except Exception as exc:
        log("ERROR %s: %s" % (type(exc).__name__, exc))
        trim_log()
        return 1
    trim_log()
    return 0


if __name__ == "__main__":
    rc = main()
    for line in LINES:
        sys.stdout.write(line + "\n")
    try:
        with open(LOG, "a") as fh:
            for line in LINES:
                fh.write(line + "\n")
    except Exception:
        pass
    sys.exit(rc)
