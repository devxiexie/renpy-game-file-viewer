"""Synthetic Ren'Py-shaped save + persistent fixtures (structure mirrors renpy.loadsave).

Usage: python3 -I scripts/make-save-fixtures.py test/fixtures/saves
"""
import io, json, os, pickle, sys, types, zipfile, zlib

out = sys.argv[1]

def module(name):
    m = types.ModuleType(name)
    sys.modules[name] = m
    if "." in name:
        parent, _, child = name.rpartition(".")
        setattr(sys.modules.get(parent) or module(parent), child, m)
    return m

rev = module("renpy.revertable")
class RevertableList(list): pass
class RevertableDict(dict): pass
for c in (RevertableList, RevertableDict):
    c.__module__ = "renpy.revertable"; setattr(rev, c.__name__, c)

store = module("store")
class Player(object):
    def __init__(self):
        self.name = "Eileen"
        self.hp = 42
        self.stats = RevertableDict(strength=7, luck=1.5)
Player.__module__ = "store"; store.Player = Player

pers_mod = module("renpy.persistent")
class Persistent(object): pass
Persistent.__module__ = "renpy.persistent"; pers_mod.Persistent = Persistent

class Log(object): pass
Log.__module__ = "renpy.python"; module("renpy.python").RollbackLog = Log; Log.__name__ = "RollbackLog"; Log.__qualname__ = "RollbackLog"

player = Player()
roots = {
    "store.money": 120,
    "store.big": 2 ** 40,
    "store.affection": 3.25,
    "store.met_sylvie": True,
    "store.mc_name": "Tom",
    "store.nothing": None,
    "store.inventory": RevertableList(["sword", "potion", 3]),
    "store.player": player,
    "store._internal": 1,
}
log = Log()
log.current = roots["store.mc_name"]  # shared reference, like a real rollback log
log.entries = RevertableList([dict(roots)])

for proto in (2, 5):
    buf = pickle.dumps((roots, log), proto)
    meta = {"_save_name": "Chapter 2", "_renpy_version": [8, 3, 0, 0], "_version": "1.0", "_game_runtime": 754.5, "_ctime": 1760000000.0}
    with zipfile.ZipFile(os.path.join(out, "proto%d-1-1-LT1.save" % proto), "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("screenshot.png", open("test/fixtures/gradient.png", "rb").read())
        z.writestr("extra_info", "Chapter 2")
        z.writestr("json", json.dumps(meta))
        z.writestr("renpy_version", "Ren'Py 8.3.0")
        z.writestr("log", buf)
        z.writestr("signatures", "signature dummy\n")

p = Persistent()
p._seen_ever = {"start": True}
p.endings = 2
p.gallery_unlocked = False
p.player_name = "Tom"
with open(os.path.join(out, "persistent"), "wb") as f:
    f.write(zlib.compress(pickle.dumps(p, 5)))
