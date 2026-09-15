#!/usr/bin/env python3
"""Preview the dashboard page without the worldserver module.

Serves web/ plus /bots and /worldmap in the same JSON shape as mod-dashboard,
built from acore_characters (positions as of the last character save, so
coarse) and the server's local DBC files. Read-only. For page development;
the real endpoints come from the module.

    python3 tools/preview_server.py [port]      # default 8788, binds 127.0.0.1
"""

import http.server
import json
import os
import re
import struct
import subprocess
import sys
import time
from functools import partial
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
DBC = Path("/opt/wow/server/data/dbc")
CONF = Path("/opt/wow/server/etc/worldserver.conf")
CONTINENTS = (0, 1, 530, 571)
INSTANCE_TYPES = {1, 2, 3, 4}  # instance, raid, battleground, arena
HORDE_RACES = {2, 5, 6, 8, 10}


def read_dbc(name):
    data = (DBC / name).read_bytes()
    magic, records, fields, size, strings = struct.unpack_from("<4s4I", data)
    assert magic == b"WDBC", name
    body = data[20:20 + records * size]
    block = data[20 + records * size:]

    def string(offset):
        end = block.index(b"\0", offset)
        return block[offset:end].decode("utf-8", "replace")

    rows = [body[i * size:(i + 1) * size] for i in range(records)]
    return rows, string


def load_worldmap():
    area_rows, area_str = read_dbc("AreaTable.dbc")
    area_names = {}
    for r in area_rows:
        area_names[struct.unpack_from("<I", r, 0)[0]] = area_str(struct.unpack_from("<I", r, 11 * 4)[0])

    map_rows, map_str = read_dbc("Map.dbc")
    maps = {}
    for r in map_rows:
        map_id, _, map_type = struct.unpack_from("<3I", r, 0)
        maps[map_id] = (map_str(struct.unpack_from("<I", r, 5 * 4)[0]), map_type)

    wma_rows, _ = read_dbc("WorldMapArea.dbc")
    zones = []
    for r in wma_rows:
        _, map_id, area_id, _, left, right, top, bottom, virtual_map = struct.unpack_from("<4I4fi", r, 0)
        if area_id:
            zones.append({"zone": area_id, "map": map_id, "virtual_map": virtual_map,
                          "name": area_names.get(area_id, ""),
                          "left": left, "right": right, "top": top, "bottom": bottom})

    doc = {"zones": zones, "continents": {str(m): maps.get(m, ("", 0))[0] for m in CONTINENTS}}
    return doc, area_names, maps


def db_password():
    text = CONF.read_text()
    m = re.search(r'^CharacterDatabaseInfo\s*=\s*"[^;]*;[^;]*;[^;]*;([^;]*);', text, re.M)
    return m.group(1)


QUERY = """
SELECT c.guid, c.name, c.level, c.class, c.race, c.map, c.zone,
       c.position_x, c.position_y, c.position_z, a.username LIKE 'RNDBOT%%'
FROM acore_characters.characters c JOIN acore_auth.account a ON a.id = c.account
WHERE c.online = 1
"""


class Handler(http.server.SimpleHTTPRequestHandler):
    worldmap = None
    area_names = {}
    maps = {}
    password = ""
    cache = (0.0, b"")

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/worldmap":
            return self.send_json(json.dumps(self.worldmap).encode())
        if path == "/bots":
            return self.send_json(self.bots())
        if path.startswith("/data/") and os.environ.get("PREVIEW_DATA"):
            # Serve data files from a scratch directory instead of web/data (PREVIEW_DATA=/some/dir).
            f = Path(os.environ["PREVIEW_DATA"]) / Path(path[len("/data/"):]).name
            if f.is_file():
                return self.send_json(f.read_bytes())
            return self.send_error(404)
        return super().do_GET()

    def send_json(self, body):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def bots(self):
        now = time.time()
        if now - Handler.cache[0] < 2:
            return Handler.cache[1]
        out = subprocess.run(["mysql", "-uacore", "-h127.0.0.1", "-B", "-N", "-e", QUERY],
                             capture_output=True, text=True, env={**os.environ, "MYSQL_PWD": self.password})
        players = []
        for line in out.stdout.splitlines():
            guid, name, level, cls, race, map_id, zone, x, y, z, bot = line.split("\t")
            map_name, map_type = self.maps.get(int(map_id), ("", 0))
            players.append({
                "guid": int(guid), "name": name, "bot": bot == "1", "level": int(level),
                "class": int(cls), "race": int(race), "team": 1 if int(race) in HORDE_RACES else 0,
                "map": int(map_id), "zone": int(zone), "zone_name": self.area_names.get(int(zone), ""),
                "area": 0, "x": float(x), "y": float(y), "z": float(z),
                "instance": map_type in INSTANCE_TYPES, "map_name": map_name,
                "combat": False, "dead": False, "mounted": False, "flight": False, "group_leader": 0,
                **({"active": True, "rpg": 0, "master": 0, "strategies": [], "combat_strategies": []}
                   if bot == "1" else {}),
            })
        doc = {"ts": int(now), "update_ms": {"avg": 0, "max": 0, "last": 0},
               "counts": {"bots": sum(p["bot"] for p in players),
                          "real": sum(not p["bot"] for p in players),
                          "active": sum(p["bot"] for p in players)},
               "players": players}
        Handler.cache = (now, json.dumps(doc).encode())
        return Handler.cache[1]

    def log_message(self, *args):
        pass


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8788
    Handler.worldmap, Handler.area_names, Handler.maps = load_worldmap()
    Handler.password = db_password()
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), partial(Handler, directory=str(WEB)))
    print(f"preview on http://127.0.0.1:{port}/", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
