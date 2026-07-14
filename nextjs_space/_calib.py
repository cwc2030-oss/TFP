#!/usr/bin/env python3
import json, math, subprocess, sys

BASE = "http://localhost:3000"
RADIUS_M = 620          # ~300-ac scope circle
BUFFER = 500            # matches scope-path bufferMeters

# Mirror the EXACT ridge request the terrain-flow route builds for scope computes.
RIDGE_OPTS = {"dem_source": "USGS3DEP1m", "min_prominence_ft": 8, "min_length_m": 60}

# label, lat, lng, expected
PARCELS = [
    ("MOD Buffalo Dallas",      37.6436, -93.0927, "moderate"),
    ("MOD Boone rolling",       38.9500, -92.9000, "moderate"),
    ("MOD Lebanon Laclede",     37.6800, -92.6600, "moderate"),
    ("MOD Camden Ozark",        38.0500, -92.7500, "moderate"),
    ("MOD Callaway",            38.8000, -91.9000, "moderate"),
    ("MOD Osage",               38.4500, -91.8500, "moderate"),
    ("MOD Warren",              38.7500, -91.4000, "moderate"),
    ("MOD Crawford Ozark",      37.9500, -91.3000, "moderate"),
    ("STEEP Douglas (ctrl)",    37.1200, -92.6600, "steep"),
    ("FLAT Newkirk OK",         36.9248, -96.9641, "flat"),
    ("FLAT Pemiscot bootheel",  36.2000, -89.8000, "flat"),
    ("FLAT Charleston MS-co",   36.9200, -89.3500, "flat"),
    ("FLAT Stoddard delta",     36.8500, -89.9500, "flat"),
]

def circle(lat, lng, r, n=24):
    pts = []
    for i in range(n):
        a = 2*math.pi*i/n
        dlat = (r*math.cos(a))/111320.0
        dlng = (r*math.sin(a))/(111320.0*math.cos(math.radians(lat)))
        pts.append([round(lng+dlng,6), round(lat+dlat,6)])
    pts.append(pts[0])
    return {"type":"Feature","properties":{},"geometry":{"type":"Polygon","coordinates":[pts]}}

def maxprom(feats):
    return max((float(f.get("properties",{}).get("prominenceFt") or 0) for f in feats), default=0.0)

def fetch(label, lat, lng):
    body = json.dumps({"parcel": circle(lat,lng,RADIUS_M), "parcel_id": "calib_"+label.replace(" ","_"),
                       "bufferMeters": BUFFER, "options": RIDGE_OPTS})
    out = subprocess.run(["curl","-s","-m","75","-X","POST",f"{BASE}/api/ridge-spines",
                          "-H","Content-Type: application/json","-d",body],
                         capture_output=True, text=True).stdout
    try:
        return json.loads(out)
    except Exception:
        return {"_parsefail": out[:160]}

rows = []
for label, lat, lng, exp in PARCELS:
    d = fetch(label, lat, lng)
    if "_parsefail" in d:
        print(f"{label:24s} PARSEFAIL {d['_parsefail']}"); continue
    pf = (d.get("ridges_primary") or {}).get("features") or []
    sf = (d.get("ridges_secondary") or {}).get("features") or []
    sn = (d.get("saddle_nodes") or {}).get("features") or []
    md = d.get("metadata") or {}
    saddle_proms = [float(f.get("properties",{}).get("prominenceFt") or f.get("properties",{}).get("dropFt") or 0) for f in sn]
    row = dict(label=label, exp=exp, dem=md.get("dem_source"), res=md.get("resolution_m"),
               p_n=len(pf), s_n=len(sf), sad_n=len(sn),
               p_maxprom=round(maxprom(pf),1), s_maxprom=round(maxprom(sf),1),
               ridge_km=round((md.get("total_ridge_length_m") or 0)/1000.0,2),
               sad_maxprom=round(max(saddle_proms, default=0.0),1),
               gate_pass=(maxprom(pf) >= 50))
    rows.append(row)
    print(json.dumps(row))

print("\n===== SUMMARY (current gate = max PRIMARY prominence >= 50 ft) =====")
hdr = f"{'parcel':24s} {'exp':8s} {'dem':9s} {'p#':>3s} {'s#':>3s} {'sad#':>4s} {'pMax':>6s} {'sMax':>6s} {'km':>5s} {'GATE':>5s}"
print(hdr); print("-"*len(hdr))
for r in rows:
    print(f"{r['label']:24s} {r['exp']:8s} {str(r['dem']):9s} {r['p_n']:>3d} {r['s_n']:>3d} {r['sad_n']:>4d} {r['p_maxprom']:>6.1f} {r['s_maxprom']:>6.1f} {r['ridge_km']:>5.2f} {str(r['gate_pass']):>5s}")
