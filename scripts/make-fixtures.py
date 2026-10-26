"""Generate small RPA + pickle fixtures with CPython, mirroring Ren'Py's archiver.

Usage: python3 -I scripts/make-fixtures.py test/fixtures
"""
import os, pickle, sys, zlib, json, base64

out = sys.argv[1]
files = {
    "images/bg room.png": bytes(range(256)) * 4,
    "script.rpy": "label start:\n    \"Hello, world.\"\n".encode("utf-8"),
    "audio/théme.ogg": b"OggS" + b"\x00" * 60,
    "empty.txt": b"",
}

def write_rpa(path, version, key, prefix_for=None, protocol=2):
    with open(path, "wb") as f:
        f.write(b"\0" * 51)  # header placeholder
        index = {}
        for name, data in files.items():
            start = b""
            if prefix_for and name == prefix_for:
                start, data = data[:16], data[16:]
            off = f.tell()
            f.write(data)
            if version == "RPA-2.0":
                index[name] = [(off, len(data))]
            elif start:
                index[name] = [(off ^ key, len(data) ^ key, start)]
            else:
                index[name] = [(off ^ key, len(data) ^ key)]
        idx = f.tell()
        f.write(zlib.compress(pickle.dumps(index, protocol)))
        f.seek(0)
        if version == "RPA-3.0":
            f.write(b"RPA-3.0 %016x %08x\n" % (idx, key))
        elif version == "RPA-3.2":
            f.write(b"RPA-3.2 %016x %08x %08x\n" % (idx, 0, key))
        elif version == "RPA-2.0":
            f.write(b"RPA-2.0 %016x\n" % idx)

write_rpa(os.path.join(out, "rpa", "v3.rpa"), "RPA-3.0", 0x42424242)
write_rpa(os.path.join(out, "rpa", "v3-prefix.rpa"), "RPA-3.0", 0x1234abcd, prefix_for="images/bg room.png", protocol=4)
write_rpa(os.path.join(out, "rpa", "v32.rpa"), "RPA-3.2", 0xdeadbeef)
write_rpa(os.path.join(out, "rpa", "v2.rpa"), "RPA-2.0", 0)
with open(os.path.join(out, "rpa", "expected.json"), "w") as f:
    json.dump({k: base64.b64encode(v).decode() for k, v in files.items()}, f, indent=1)

# Pickle round-trip fixtures across protocols.
class Thing(object):
    def __init__(self):
        self.name = u"thing"
        self.values = [1, -2, 3.5, 2**70, -(2**40), None, True, False]
        self.nested = {u"k": (1, 2), (3, 4): u"tuple key", u"bytes": b"\x00\xffabc"}
        self.text = u"héllo ✓ \U0001F600"
import types
mod = types.ModuleType("fixturemod")
mod.Thing = Thing
Thing.__module__ = "fixturemod"
Thing.__qualname__ = "Thing"
sys.modules["fixturemod"] = mod
value = {u"thing": Thing(), u"list": [Thing(), Thing()], u"set": {1, 2, 3}, u"frozen": frozenset([u"a"]), u"empty": ((), [], {})}
value[u"list"].append(value[u"list"][0])  # shared reference
pk = {str(p): base64.b64encode(pickle.dumps(value, p)).decode() for p in range(0, 6)}
with open(os.path.join(out, "pickle", "protocols.json"), "w") as f:
    json.dump(pk, f, indent=1)
