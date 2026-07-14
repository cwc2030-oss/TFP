import json, math, subprocess

BASE = "http://localhost:3000"
RADIUS_M = 620; BUFFER = 500
RIDGE_OPTS = {"dem_source": "USGS3DEP1m", "min_prominence_ft": 8, "min_length_m": 60}

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
def maxdrop(feats):
    return max((float(f.get("properties",{}).get("ridgeDropFt") or 0) for f in feats), default=0.0)

def fetch(label, lat, lng):
    body = json.dumps({"parcel": circle(lat,lng,RADIUS_M), "parcel_id": "c2_"+label.replace(" ","_"),
                       "bufferMeters": BUFFER, "options": RIDGE_OPTS})
    out = subprocess.run(["curl","-s","-m","90","-X","POST",f"{BASE}/api/ridge-spines",
                          "-H","Content-Type: application/json","-d",body],
                         capture_output=True, text=True).stdout
    try: return json.loads(out)
    except Exception: return {"_pf": out[:160]}

rows = []
for label, lat, lng, exp in PARCELS:
    d = fetch(label, lat, lng)
    if "_pf" in d: print(f"{label:24s} PARSEFAIL {d['_pf']}"); continue
    pf = (d.get("ridges_primary") or {}).get("features") or []
    sf = (d.get("ridges_secondary") or {}).get("features") or []
    sn = (d.get("saddle_nodes") or {}).get("features") or []
    md = d.get("metadata") or {}
    r = dict(label=label, exp=exp, dem=md.get("dem_source"),
             p_n=len(pf), s_n=len(sf), sad_n=len(sn),
             pMax=round(maxprom(pf),1), sMax=round(maxprom(sf),1),
             sadDrop=round(maxdrop(sn),1),
             combo=round(max(maxprom(pf),maxprom(sf)),1))
    rows.append(r)

print("\n===== CALIBRATION v2 (with saddle ridgeDropFt) =====")
hdr = f"{'parcel':24s} {'exp':8s} {'p#':>3s} {'s#':>3s} {'sad#':>4s} {'pMax':>6s} {'sMax':>6s} {'combo':>6s} {'sadDrop':>7s}"
print(hdr); print("-"*len(hdr))
for r in rows:
    print(f"{r['label']:24s} {r['exp']:8s} {r['p_n']:>3d} {r['s_n']:>3d} {r['sad_n']:>4d} {r['pMax']:>6.1f} {r['sMax']:>6.1f} {r['combo']:>6.1f} {r['sadDrop']:>7.1f}")

print("\n--- separation analysis ---")
for metric in ["pMax","combo","sadDrop"]:
    modvals = sorted(r[metric] for r in rows if r['exp']=='moderate')
    flatvals = sorted(r[metric] for r in rows if r['exp']=='flat')
    print(f"{metric:8s}  moderate={modvals}   flat={flatvals}")
